import { serve } from '@hono/node-server';
import app from './src/app';

const port = parseInt(process.env.PORT ?? '3000', 10);

serve({
  port,
  async fetch(req, env) {
    console.log(`→ ${req.method} ${req.url}`);
    try {
      const res = await app.fetch(req, env);
      console.log(`← ${res.status}`);
      return res;
    } catch (err) {
      console.error('app.fetch threw:', err);
      return new Response(`Internal error: ${(err as Error)?.message ?? err}`, { status: 500 });
    }
  },
}, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
  if (!process.env.NPS_API_KEY) {
    console.warn('WARNING: NPS_API_KEY is not set — all requests will return 500');
  }
});
