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

// ── shared helpers ────────────────────────────────────────────────────────────

// A stable synthetic cache key — any valid URL works with caches.open().
const CF_PARKS_CACHE_KEY = 'https://nps-ical.internal/parks-v1';

// Returns the Cloudflare named-cache handle, or null in Node.js where the
// Cache API is unavailable.
async function openCFCache(): Promise<{ match(k: string): Promise<Response | undefined>; put(k: string, v: Response): Promise<void> } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (globalThis as any).caches?.open?.('nps-ical') ?? null;
  } catch {
    return null;
  }
}

async function getParks(apiKey: string, ttlMs: number): Promise<NpsPark[]> {
  // 1. In-process cache (same Worker instance, fastest)
  const inProcess = appCache.get<NpsPark[]>('parks');
  if (inProcess) return inProcess;

  // 2. Cloudflare shared cache (survives across Worker instances)
  const cfCache = await openCFCache();
  if (cfCache) {
    const hit = await cfCache.match(CF_PARKS_CACHE_KEY);
    if (hit) {
      console.log('[cache] parks CF HIT');
      const parks = (await hit.json()) as NpsPark[];
      appCache.set('parks', parks, ttlMs);
      return parks;
    }
  }

  // 3. Fetch from NPS API
  const parks = await fetchAllParks(apiKey);
  appCache.set('parks', parks, ttlMs);

  // Populate Cloudflare cache so other Worker instances benefit.
  if (cfCache) {
    const ttlSecs = Math.round(ttlMs / 1000);
    await cfCache.put(
      CF_PARKS_CACHE_KEY,
      new Response(JSON.stringify(parks), {
        headers: { 'Cache-Control': `public, max-age=${ttlSecs}` },
      }),
    );
  }

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

  const timezone = timezoneForCoords(park.latitude, park.longitude);
  const icsData = generateICS(parkCode, park.fullName, events, timezone);
  appCache.set(cacheKey, icsData, icsTtlMs);
  return new Response(icsData, { status: 200, headers: icsHeaders(icsHours, 'MISS') });
});

export default app;
