import { serve } from '@hono/node-server';
import app from './src/app';

const port = parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
