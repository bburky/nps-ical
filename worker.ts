import app from './src/app';

// Cloudflare Workers / Pages entry point.
// Environment variables are passed via wrangler.toml [vars] or the dashboard.
// NPS_API_KEY must be set as a secret: `wrangler secret put NPS_API_KEY`
export default app;
