import { Hono, type Context } from 'hono';
import { Cache } from './cache';
import { fetchAllParks, fetchParkEvents, findPark, type NpsPark } from './nps';
import { generateICS, timezoneForCoords } from './ical';
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

// ── Cloudflare Cache API helpers ──────────────────────────────────────────────

type CFCache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, value: Response): Promise<void>;
} | null;

// Opens the named Cloudflare Workers cache, or returns null in Node.js where
// the Cache API is unavailable. All synthetic keys use https://nps-ical.internal/*.
async function openCFCache(): Promise<CFCache> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (globalThis as any).caches?.open?.('nps-ical') ?? null;
  } catch {
    return null;
  }
}

async function cfGet(cache: CFCache, key: string): Promise<Response | null> {
  if (!cache) return null;
  return (await cache.match(key)) ?? null;
}

async function cfPut(cache: CFCache, key: string, body: string, ttlSecs: number, contentType: string): Promise<void> {
  if (!cache) return;
  await cache.put(key, new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ttlSecs}`,
    },
  }));
}

// ── park list (in-process → CF Cache → NPS API) ───────────────────────────────

async function getParks(apiKey: string, ttlMs: number, cfCache: CFCache): Promise<NpsPark[]> {
  const inProcess = appCache.get<NpsPark[]>('parks');
  if (inProcess) return inProcess;

  const cfHit = await cfGet(cfCache, 'https://nps-ical.internal/parks');
  if (cfHit) {
    console.log('[cache] parks CF HIT');
    const parks = (await cfHit.json()) as NpsPark[];
    appCache.set('parks', parks, ttlMs);
    return parks;
  }

  const parks = await fetchAllParks(apiKey);
  appCache.set('parks', parks, ttlMs);
  await cfPut(cfCache, 'https://nps-ical.internal/parks', JSON.stringify(parks), Math.round(ttlMs / 1000), 'application/json');
  return parks;
}

// ── response headers ──────────────────────────────────────────────────────────

function icsHeaders(hours: number): Record<string, string> {
  return {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': `public, max-age=${hours * 3600}, stale-while-revalidate=1800`,
    'X-Published-TTL': `PT${hours}H`,
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
  const cfKey      = 'https://nps-ical.internal/index';

  const inProcess = appCache.get<string>('index:html');
  if (inProcess) {
    return c.html(inProcess, 200, { 'Cache-Control': indexCC });
  }

  const cfCache = await openCFCache();
  const cfHit = await cfGet(cfCache, cfKey);
  if (cfHit) {
    console.log('[cache] index CF HIT');
    const html = await cfHit.text();
    appCache.set('index:html', html, indexTtlMs);
    return c.html(html, 200, { 'Cache-Control': indexCC });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    console.error('[ERROR] NPS_API_KEY is not set');
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  console.log('[nps] fetching all parks…');
  let parks: NpsPark[];
  try {
    parks = await getParks(apiKey, indexTtlMs, cfCache);
  } catch (err) {
    console.error('[ERROR] fetchAllParks:', err);
    return c.text(`Failed to fetch parks from NPS API: ${(err as Error).message}`, 502);
  }
  console.log(`[nps] got ${parks.length} parks`);

  const html = renderIndex(parks, { indexCacheHours: indexHours, icsCacheHours: icsHours });
  appCache.set('index:html', html, indexTtlMs);
  await cfPut(cfCache, cfKey, html, indexHours * 3600, 'text/html; charset=utf-8');
  return c.html(html, 200, { 'Cache-Control': indexCC });
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

  const icsHours = getCacheHours(c, 'ICS_CACHE_HOURS', 12);
  const icsTtlMs = icsHours * 3600 * 1000;
  const appKey   = `ics:${parkCode}`;
  const cfKey    = `https://nps-ical.internal/ics/${parkCode}`;

  const inProcess = appCache.get<string>(appKey);
  if (inProcess) {
    return new Response(inProcess, { status: 200, headers: icsHeaders(icsHours) });
  }

  const cfCache = await openCFCache();
  const cfHit = await cfGet(cfCache, cfKey);
  if (cfHit) {
    console.log(`[cache] ${appKey} CF HIT`);
    const icsData = await cfHit.text();
    appCache.set(appKey, icsData, icsTtlMs);
    return new Response(icsData, { status: 200, headers: icsHeaders(icsHours) });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    console.error('[ERROR] NPS_API_KEY is not set');
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  const indexHours = getCacheHours(c, 'INDEX_CACHE_HOURS', 24);
  let parks: NpsPark[];
  try {
    parks = await getParks(apiKey, indexHours * 3600 * 1000, cfCache);
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

  const timezone = timezoneForCoords(park.latitude, park.longitude);
  const icsData = generateICS(parkCode, park.fullName, events, timezone);
  appCache.set(appKey, icsData, icsTtlMs);
  await cfPut(cfCache, cfKey, icsData, icsHours * 3600, 'text/calendar; charset=utf-8');
  return new Response(icsData, { status: 200, headers: icsHeaders(icsHours) });
});

export default app;
