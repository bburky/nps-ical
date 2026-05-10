import { Hono, type Context } from 'hono';
import { Cache } from './cache';
import { fetchAllParks, fetchParkEvents, findPark, type NpsPark } from './nps';
import { generateICS } from './ical';
import { renderIndex } from './template';

// Bindings for Cloudflare Workers / other serverless platforms.
// All vars are strings; NPS_API_KEY should be set as a secret.
type Bindings = {
  NPS_API_KEY?: string;
  INDEX_CACHE_HOURS?: string;
  ICS_CACHE_HOURS?: string;
};

const appCache = new Cache();
const app = new Hono<{ Bindings: Bindings }>();

// ── env helpers ───────────────────────────────────────────────────────────────

function getEnv(c: Context<{ Bindings: Bindings }>, key: keyof Bindings): string | undefined {
  return c.env?.[key] ?? (typeof process !== 'undefined' ? process.env[key] : undefined);
}

function getApiKey(c: Context<{ Bindings: Bindings }>): string {
  return getEnv(c, 'NPS_API_KEY') ?? '';
}

function getCacheHours(c: Context<{ Bindings: Bindings }>, key: keyof Bindings, defaultHours: number): number {
  const n = parseInt(getEnv(c, key) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : defaultHours;
}

// ── shared helpers ────────────────────────────────────────────────────────────

async function getParks(apiKey: string, ttlMs: number): Promise<NpsPark[]> {
  const cached = appCache.get<NpsPark[]>('parks');
  if (cached) return cached;
  const parks = await fetchAllParks(apiKey);
  appCache.set('parks', parks, ttlMs);
  return parks;
}

function icsHeaders(hours: number, cacheStatus: 'HIT' | 'MISS'): Record<string, string> {
  const secs = hours * 3600;
  return {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': `public, max-age=${secs}, stale-while-revalidate=1800`,
    'X-Published-TTL': `PT${hours}H`,
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

  const indexHours = getCacheHours(c, 'INDEX_CACHE_HOURS', 24);
  const icsHours   = getCacheHours(c, 'ICS_CACHE_HOURS', 12);
  const indexTtlMs = indexHours * 3600 * 1000;
  const indexCC    = `public, max-age=${indexHours * 3600}, stale-while-revalidate=3600`;

  const cached = appCache.get<string>('index:html');
  if (cached) {
    console.log('[cache] index HIT');
    return c.html(cached, 200, { 'Cache-Control': indexCC, 'X-Cache': 'HIT' });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    console.error('[ERROR] NPS_API_KEY is not set');
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  console.log('[nps] fetching all parks…');
  let parks: NpsPark[];
  try {
    parks = await getParks(apiKey, indexTtlMs);
  } catch (err) {
    console.error('[ERROR] fetchAllParks:', err);
    return c.text(`Failed to fetch parks from NPS API: ${(err as Error).message}`, 502);
  }
  console.log(`[nps] got ${parks.length} parks`);

  const html = renderIndex(parks, { indexCacheHours: indexHours, icsCacheHours: icsHours });
  appCache.set('index:html', html, indexTtlMs);
  return c.html(html, 200, { 'Cache-Control': indexCC, 'X-Cache': 'MISS' });
});

/**
 * GET /:parkCode.ics
 * iCal feed for a park's upcoming events. e.g. /hosp.ics, /yell.ics
 */
app.get('/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!filename.endsWith('.ics')) return c.notFound();
  const parkCode = filename.slice(0, -4).toLowerCase();
  console.log(`[GET] /${parkCode}.ics`);

  const icsHours   = getCacheHours(c, 'ICS_CACHE_HOURS', 12);
  const icsTtlMs   = icsHours * 3600 * 1000;
  const cacheKey   = `ics:${parkCode}`;

  const cached = appCache.get<string>(cacheKey);
  if (cached) {
    console.log(`[cache] ${cacheKey} HIT`);
    return new Response(cached, { status: 200, headers: icsHeaders(icsHours, 'HIT') });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    console.error('[ERROR] NPS_API_KEY is not set');
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  const indexHours = getCacheHours(c, 'INDEX_CACHE_HOURS', 24);
  let parks: NpsPark[];
  try {
    parks = await getParks(apiKey, indexHours * 3600 * 1000);
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
  appCache.set(cacheKey, icsData, icsTtlMs);
  return new Response(icsData, { status: 200, headers: icsHeaders(icsHours, 'MISS') });
});

export default app;
