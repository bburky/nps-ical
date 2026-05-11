> Vibecoded with [Claude](https://claude.ai), no promises on accuracy.

# nps-ical

iCal event feeds for US National Park Service sites, plus an index page listing every park with links to subscribe in Apple Calendar, Google Calendar, or any iCal-compatible app.

Data is sourced from the [NPS API](https://www.nps.gov/subjects/developer/).

## Endpoints

| Route | Description |
|---|---|
| `GET /` | Park index page with search |
| `GET /:parkCode.ics` | iCal feed for a park's events (e.g. `/hosp.ics`, `/yell.ics`) |

Park codes match the codes used in NPS URLs (e.g. `nps.gov/yell/`).

## Configuration

All config is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `NPS_API_KEY` | — | **Required.** NPS API key. Get one free at [nps.gov/subjects/developer](https://www.nps.gov/subjects/developer/get-started.htm) |
| `INDEX_CACHE_HOURS` | `24` | How long to cache the park index page |
| `ICS_CACHE_HOURS` | `12` | How long to cache iCal feeds (`Cache-Control` + `REFRESH-INTERVAL` + cache store TTL) |
| `PORT` | `3000` | Node.js only |

## Node.js

```sh
npm install
NPS_API_KEY=your_key npm start          # http://localhost:3000
NPS_API_KEY=your_key npm run dev        # watch mode
NPS_API_KEY=your_key INDEX_CACHE_HOURS=6 ICS_CACHE_HOURS=3 npm start
npm run typecheck
```

## Cloudflare Workers

`worker.ts` is the entry point. `wrangler.toml` sets default values for `INDEX_CACHE_HOURS` and `ICS_CACHE_HOURS`; edit those there or override per-environment.

### First-time setup

```sh
# Set the API key as a secret (not a plain var)
npx wrangler secret put NPS_API_KEY

# Local dev (uses workerd runtime, mirrors production)
npm run cf:dev

# Deploy
npm run cf:deploy
```

### Cloudflare Pages

To deploy as a Pages project instead of a Worker:

```sh
# Local dev
npx wrangler pages dev --compatibility-date=2024-09-23 worker.ts

# Deploy (create the project in the dashboard first)
npx wrangler pages deploy --project-name=nps-ical worker.ts
```

Or connect your repo in the Cloudflare Pages dashboard and set:
- **Build command:** *(none)*
- **Build output directory:** *(none / leave blank)*
- **Entry point:** `worker.ts`

Set `NPS_API_KEY` under **Settings → Environment variables → Add secret**.

## Caching

Cloudflare Workers receive every request regardless of `Cache-Control` headers — the CDN does not automatically cache Worker responses. Caching is handled explicitly inside the Worker using the [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).

| Layer | What's stored | TTL |
|---|---|---|
| **In-process** (per Worker instance) | Park list, index HTML, ICS per park | `INDEX_CACHE_HOURS` / `ICS_CACHE_HOURS` |
| **Cloudflare Cache API** (shared across all instances) | Park list, index HTML, ICS per park | Same TTLs |
| **HTTP `Cache-Control`** (subscriber's calendar app) | iCal feeds | `ICS_CACHE_HOURS` |
| **iCal client hint** | — | `REFRESH-INTERVAL:PT{n}H` + `X-Published-TTL: PT{n}H` |

Lookup order on a cache miss: in-process → CF Cache → NPS API / ICS generation. Both caches are populated on a miss so subsequent requests — including from other Worker instances — are served from cache.

When running locally with Node.js the CF Cache layer is skipped entirely (`globalThis.caches` is unavailable); only the in-process cache is used.

## OpenAPI spec

See [`openapi.yaml`](./openapi.yaml).
