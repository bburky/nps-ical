import { Hono, type Context } from 'hono';
import { Cache } from './cache';
import { fetchAllParks, fetchParkEvents, findPark, type NpsPark } from './nps';
import { generateICS } from './ical';
import { renderIndex } from './template';

const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
const ICS_TTL_MS = 12 * 60 * 60 * 1000;
const INDEX_CC = 'public, max-age=86400, stale-while-revalidate=3600';
const ICS_CC = 'public, max-age=43200, stale-while-revalidate=1800';

// Bindings type for Cloudflare Workers / other serverless platforms
type Bindings = { NPS_API_KEY?: string };

const appCache = new Cache();
const app = new Hono<{ Bindings: Bindings }>();

function getApiKey(c: Context<{ Bindings: Bindings }>): string {
  return c.env?.NPS_API_KEY
    ?? (typeof process !== 'undefined' ? process.env.NPS_API_KEY : undefined)
    ?? '';
}

async function getParks(apiKey: string): Promise<NpsPark[]> {
  const cached = appCache.get<NpsPark[]>('parks');
  if (cached) return cached;
  const parks = await fetchAllParks(apiKey);
  appCache.set('parks', parks, INDEX_TTL_MS);
  return parks;
}

function icsHeaders(cacheStatus: 'HIT' | 'MISS'): Record<string, string> {
  return {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': ICS_CC,
    'X-Published-TTL': 'PT12H',
    'X-Cache': cacheStatus,
  };
}

// ── global error handler ──────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.url}`, err);
  return c.text(`Internal server error: ${err.message}`, 500);
});

// ── routes ────────────────────────────────────────────────────────────────────

/**
 * GET /
 * Server-rendered park index — all data is embedded, no client-side API calls.
 */
app.get('/', async (c) => {
  console.log('[GET] /');

  const cached = appCache.get<string>('index:html');
  if (cached) {
    console.log('[cache] index HIT');
    return c.html(cached, 200, { 'Cache-Control': INDEX_CC, 'X-Cache': 'HIT' });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    console.error('[ERROR] NPS_API_KEY is not set');
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  console.log('[nps] fetching all parks…');
  let parks: NpsPark[];
  try {
    parks = await getParks(apiKey);
  } catch (err) {
    console.error('[ERROR] fetchAllParks:', err);
    return c.text(`Failed to fetch parks from NPS API: ${(err as Error).message}`, 502);
  }
  console.log(`[nps] got ${parks.length} parks`);

  const html = renderIndex(parks);
  appCache.set('index:html', html, INDEX_TTL_MS);
  return c.html(html, 200, { 'Cache-Control': INDEX_CC, 'X-Cache': 'MISS' });
});

/**
 * GET /:parkCode.ics
 * iCal feed for a park's upcoming events. e.g. /hosp.ics, /yell.ics
 *
 * The {[a-z0-9-]+} constraint prevents `:parkCode` from consuming the `.ics` suffix.
 */
app.get('/:parkCode{[a-z0-9-]+}.ics', async (c) => {
  const parkCode = c.req.param('parkCode').toLowerCase();
  console.log(`[GET] /${parkCode}.ics`);

  const cacheKey = `ics:${parkCode}`;
  const cached = appCache.get<string>(cacheKey);
  if (cached) {
    console.log(`[cache] ${cacheKey} HIT`);
    return new Response(cached, { status: 200, headers: icsHeaders('HIT') });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    console.error('[ERROR] NPS_API_KEY is not set');
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  let parks: NpsPark[];
  try {
    parks = await getParks(apiKey);
  } catch (err) {
    console.error('[ERROR] fetchAllParks:', err);
    return c.text(`Failed to fetch parks from NPS API: ${(err as Error).message}`, 502);
  }

  const park = findPark(parks, parkCode);
  if (!park) return c.text(`Park code "${parkCode}" not found.`, 404);

  console.log(`[nps] fetching events for ${parkCode}…`);
  let events;
  try {
    events = await fetchParkEvents(apiKey, parkCode);
  } catch (err) {
    console.error(`[ERROR] fetchParkEvents(${parkCode}):`, err);
    return c.text(`Failed to fetch events from NPS API: ${(err as Error).message}`, 502);
  }
  console.log(`[nps] got ${events.length} events for ${parkCode}`);

  const icsData = generateICS(parkCode, park.fullName, events);
  appCache.set(cacheKey, icsData, ICS_TTL_MS);
  return new Response(icsData, { status: 200, headers: icsHeaders('MISS') });
});

export default app;
