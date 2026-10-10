import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { Config } from './config.js';
import { UpstreamError } from './google/errors.js';
import { locationRouter } from './routes/location.js';
import { recommendationsRouter } from './routes/recommendations.js';
import { spotsRouter } from './routes/spots.js';

export function createApp(config: Config, fetchFn: typeof fetch = fetch) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );
  app.use('/api/location', locationRouter(config.googleApiKey, fetchFn));
  app.use('/api/spots', spotsRouter(config.googleApiKey, fetchFn, config.cacheTtlMs));
  app.use('/api/recommendations', recommendationsRouter(config, fetchFn));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof UpstreamError) {
      console.error(err.message);
      // 404 from Geolocation means "no fix for these signals"; anything else is our problem upstream.
      const status = err.status === 404 ? 404 : err.status === 429 ? 503 : 502;
      res.status(status).json({ error: `${err.service} request failed`, detail: err.detail });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body must be valid JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);

  return app;
}
