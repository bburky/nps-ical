import { Hono } from 'hono';
import { Cache } from './cache.js';
import { fetchAllParks, fetchParkEvents, findPark } from './nps.js';
import { generateICS } from './ical.js';
import { renderIndex } from './template.js';

// TTLs
const INDEX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hr
const ICS_TTL_MS = 12 * 60 * 60 * 1000;   // 12 hr
const INDEX_CC = 'public, max-age=86400, stale-while-revalidate=3600';
const ICS_CC = 'public, max-age=43200, stale-while-revalidate=1800';

const appCache = new Cache();

const app = new Hono();

// ── helpers ──────────────────────────────────────────────────────────────────

function getApiKey(c) {
  // c.env is the bindings object on Cloudflare Workers; fall back to process.env for Node
  return (c.env && c.env.NPS_API_KEY) || (typeof process !== 'undefined' && process.env.NPS_API_KEY) || '';
}

async function getParks(apiKey) {
  let parks = appCache.get('parks');
  if (!parks) {
    parks = await fetchAllParks(apiKey);
    appCache.set('parks', parks, INDEX_TTL_MS);
  }
  return parks;
}

// ── routes ────────────────────────────────────────────────────────────────────

/**
 * GET /
 * Index page listing all parks with search and iCal links.
 * Server-renders everything; no client-side API calls.
 */
app.get('/', async (c) => {
  const cached = appCache.get('index:html');
  if (cached) {
    return c.html(cached, 200, {
      'Cache-Control': INDEX_CC,
      'X-Cache': 'HIT',
    });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  let parks;
  try {
    parks = await getParks(apiKey);
  } catch (err) {
    return c.text(`Failed to fetch parks from NPS API: ${err.message}`, 502);
  }

  const html = renderIndex(parks);
  appCache.set('index:html', html, INDEX_TTL_MS);

  return c.html(html, 200, {
    'Cache-Control': INDEX_CC,
    'X-Cache': 'MISS',
  });
});

/**
 * GET /ics/:parkCode
 * iCal feed for a specific park's upcoming events.
 * e.g. /ics/hosp  →  Hot Springs National Park
 */
app.get('/ics/:parkCode', async (c) => {
  const parkCode = c.req.param('parkCode').toLowerCase();
  const cacheKey = `ics:${parkCode}`;

  const cached = appCache.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: icsHeaders('HIT'),
    });
  }

  const apiKey = getApiKey(c);
  if (!apiKey) {
    return c.text('NPS_API_KEY environment variable is not set.', 500);
  }

  // Verify the park exists and get its full name
  let parks;
  try {
    parks = await getParks(apiKey);
  } catch (err) {
    return c.text(`Failed to fetch parks from NPS API: ${err.message}`, 502);
  }

  const park = findPark(parks, parkCode);
  if (!park) {
    return c.text(`Park code "${parkCode}" not found.`, 404);
  }

  let events;
  try {
    events = await fetchParkEvents(apiKey, parkCode);
  } catch (err) {
    return c.text(`Failed to fetch events from NPS API: ${err.message}`, 502);
  }

  let icsData;
  try {
    icsData = generateICS(parkCode, park.fullName, events);
  } catch (err) {
    return c.text(`Failed to generate iCal data: ${err.message}`, 500);
  }

  appCache.set(cacheKey, icsData, ICS_TTL_MS);

  return new Response(icsData, {
    status: 200,
    headers: icsHeaders('MISS'),
  });
});

function icsHeaders(cacheStatus) {
  return {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': ICS_CC,
    'X-Published-TTL': 'PT12H',
    'X-Cache': cacheStatus,
  };
}

export default app;
