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
| `INDEX_CACHE_HOURS` | `24` | How long to cache the park index page (in-process + `Cache-Control`) |
| `ICS_CACHE_HOURS` | `12` | How long to cache iCal feeds (in-process + `Cache-Control` + `REFRESH-INTERVAL`) |
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

### Caching on Cloudflare

Both responses include `Cache-Control: public, max-age=…` which Cloudflare respects at the edge automatically. You can verify caching is working by checking the `cf-cache-status` response header (`HIT` = served from edge cache).

If HTML responses aren't being cached at the edge (some plans/configurations exclude HTML by default), add a **Cache Rule** in the Cloudflare dashboard:

- **When:** `hostname is your-domain.com`
- **Cache eligibility:** Cache everything
- **Edge TTL:** Override — use `Cache-Control` header value

`.ics` responses should be cached automatically on all plans since Cloudflare treats that extension as cacheable by default.

## Caching summary

| Layer | Index page | iCal feeds |
|---|---|---|
| In-process (per-instance TTL) | `INDEX_CACHE_HOURS` | `ICS_CACHE_HOURS` |
| HTTP `Cache-Control` | `public, max-age=INDEX_CACHE_HOURS×3600, stale-while-revalidate=3600` | `public, max-age=ICS_CACHE_HOURS×3600, stale-while-revalidate=1800` |
| iCal client hint | — | `REFRESH-INTERVAL:PT{n}H` + `X-Published-TTL: PT{n}H` |

## OpenAPI spec

See [`openapi.yaml`](./openapi.yaml).
