import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { Config } from './config.js';
import { UpstreamError } from './google/errors.js';
import type { Catalog } from './huddle/catalog.js';
import { spectrumSender } from './photon/send.js';
import { spectrumUsers } from './photon/users.js';
import type { Store } from './huddle/store.js';
import { fansRouter } from './routes/fans.js';
import { gamesRouter } from './routes/games.js';
import { crewsRouter } from './routes/crews.js';
import { eventsRouter } from './routes/events.js';
import { locateRouter } from './routes/locate.js';
import { locationRouter } from './routes/location.js';
import { recommendationsRouter } from './routes/recommendations.js';
import { spotsRouter } from './routes/spots.js';

export function createApp(
  config: Config,
  fetchFn: typeof fetch = fetch,
  huddle?: { catalog: Catalog; store: Store },
) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  // /api/health is the public path on Vercel, where only /api/* reaches this service.
  // `configured` shows which keys are present (never their values).
  app.get(['/health', '/api/health'], (_req, res) => {
    res.json({
      ok: true,
      configured: {
        googleMaps: Boolean(config.googleApiKey),
        gemini: Boolean(config.geminiApiKey),
        photon: Boolean(config.spectrum),
      },
    });
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
  if (!config.googleApiKey) {
    app.use(['/api/location', '/api/spots', '/api/recommendations'], (_req, res) => {
      res.status(503).json({ error: 'Server is missing GOOGLE_MAPS_API_KEY' });
    });
  }
  app.use('/api/location', locationRouter(config.googleApiKey, fetchFn));
  app.use('/api/spots', spotsRouter(config.googleApiKey, fetchFn, config.cacheTtlMs));
  app.use('/api/recommendations', recommendationsRouter(config, fetchFn));
  if (huddle) {
    app.use('/api/games', gamesRouter(huddle.catalog, huddle.store));
    app.use(
      '/api/fans',
      fansRouter(huddle.store, {
        huddleNumber: config.huddleNumber,
        registerSpectrumUser: config.spectrum ? spectrumUsers(config.spectrum, fetchFn) : undefined,
      }),
    );
    const sendTexts = config.spectrum
      ? spectrumSender(config.spectrum.projectId, config.spectrum.projectSecret)
      : undefined;
    app.use('/api/crews', crewsRouter(huddle.store, config.linkSecret));
    if (config.googleApiKey) {
      app.use(
        '/api/events',
        eventsRouter({ store: huddle.store, apiKey: config.googleApiKey, linkSecret: config.linkSecret, fetchFn, sendTexts }),
      );
    }
    if (config.linkSecret && config.googleApiKey) {
      app.use(
        '/api/locate',
        locateRouter({
          apiKey: config.googleApiKey,
          linkSecret: config.linkSecret,
          catalog: huddle.catalog,
          gemini: config.geminiApiKey ? { apiKey: config.geminiApiKey, model: config.geminiModel! } : undefined,
          fetchFn,
          sendTexts,
          store: huddle.store,
        }),
      );
    }
  }

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
