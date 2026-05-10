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

## Setup

Get a free API key at <https://www.nps.gov/subjects/developer/get-started.htm>, then:

```sh
npm install
NPS_API_KEY=your_key npm start      # http://localhost:3000
NPS_API_KEY=your_key npm run dev    # watch mode
npm run typecheck
```

## Caching

| Layer | Index page | iCal feeds |
|---|---|---|
| In-process (TTL) | 24 hr | 12 hr |
| HTTP `Cache-Control` | `public, max-age=86400, stale-while-revalidate=3600` | `public, max-age=43200, stale-while-revalidate=1800` |
| iCal client hint | — | `REFRESH-INTERVAL:PT12H` + `X-Published-TTL: PT12H` |

## Serverless deployment

`src/app.ts` exports a standard `fetch`-compatible Hono app. Use it directly with any edge/serverless platform:

```ts
// Cloudflare Workers
import app from './src/app';
export default app;

// Vercel
import { handle } from '@hono/vercel';
import app from './src/app';
export default handle(app);
```

Set the `NPS_API_KEY` environment variable in your platform's settings.

## OpenAPI spec

See [`openapi.yaml`](./openapi.yaml).
