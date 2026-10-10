import { Router } from 'express';
import { TtlCache } from '../cache.js';
import {
  searchWatchSpots,
  WATCH_SPOT_TYPES,
  type SpotSearch,
  type WatchSpot,
  type WatchSpotType,
} from '../google/places.js';

const DEFAULT_RADIUS = 2000;
const MAX_RADIUS = 50_000; // Places API limit
const MAX_RESULTS = 20; // Places API limit per request

// GET /api/spots?lat=..&lng=..[&radius=meters][&types=bar,cafe][&q=sports bar][&limit=20]
export function spotsRouter(apiKey: string, fetchFn: typeof fetch, cacheTtlMs: number): Router {
  const router = Router();
  const cache = new TtlCache<WatchSpot[]>(cacheTtlMs);

  router.get('/', async (req, res, next) => {
    const parsed = parseSearch(req.query as Record<string, string | undefined>);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const spots = await cache.getOrLoad(cacheKey(parsed), () =>
        searchWatchSpots(apiKey, parsed, fetchFn),
      );
      res.json({ count: spots.length, spots });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function parseSearch(q: Record<string, string | undefined>): SpotSearch | { error: string } {
  const lat = Number(q.lat);
  const lng = Number(q.lng);
  if (q.lat === undefined || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: 'lat must be a number between -90 and 90' };
  }
  if (q.lng === undefined || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: 'lng must be a number between -180 and 180' };
  }

  const radiusMeters = q.radius === undefined ? DEFAULT_RADIUS : Number(q.radius);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > MAX_RADIUS) {
    return { error: `radius must be between 1 and ${MAX_RADIUS} meters` };
  }

  const maxResults = q.limit === undefined ? MAX_RESULTS : Number(q.limit);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
    return { error: `limit must be an integer between 1 and ${MAX_RESULTS}` };
  }

  const types = q.types ? q.types.split(',').map((t) => t.trim()) : [...WATCH_SPOT_TYPES];
  const unknown = types.filter((t) => !(WATCH_SPOT_TYPES as readonly string[]).includes(t));
  if (unknown.length) {
    return { error: `unsupported types: ${unknown.join(', ')}. Use ${WATCH_SPOT_TYPES.join(', ')}` };
  }

  const query = q.q?.trim() || undefined;
  return { lat, lng, radiusMeters, types: types as WatchSpotType[], query, maxResults };
}

// Rounding to 3 decimals (~110 m) lets nearby users share cached results.
export function cacheKey(s: SpotSearch): string {
  return [
    s.lat.toFixed(3),
    s.lng.toFixed(3),
    s.radiusMeters,
    [...s.types].sort().join('|'),
    s.query?.toLowerCase() ?? '',
    s.maxResults,
  ].join(':');
}
