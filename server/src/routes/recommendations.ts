import { Router } from 'express';
import { TtlCache } from '../cache.js';
import type { Config } from '../config.js';
import { searchWatchSpots, type WatchSpot } from '../google/places.js';
import type { FanPrefs } from '../recommendations/eligibility.js';
import { recommendSpots } from '../recommendations/recommend.js';
import { cacheKey, parseSearch } from './spots.js';

// team and vibe end up in the Gemini prompt, so keep them short and plain.
const PREF_PATTERN = /^[\p{L}\p{N} .'&-]{1,40}$/u;

// GET /api/recommendations?lat=..&lng=..[&team=Hawks][&vibe=chill][&is21=true]
// Also accepts every /api/spots param (radius, types, q, limit) for the Places search.
export function recommendationsRouter(config: Config, fetchFn: typeof fetch): Router {
  const router = Router();
  const cache = new TtlCache<WatchSpot[]>(config.cacheTtlMs);
  const gemini =
    config.geminiApiKey && config.geminiModel
      ? { apiKey: config.geminiApiKey, model: config.geminiModel }
      : undefined;

  router.get('/', async (req, res, next) => {
    const query = req.query as Record<string, string | undefined>;
    const search = parseSearch(query);
    if ('error' in search) {
      res.status(400).json({ error: search.error });
      return;
    }
    const prefs = parsePrefs(query);
    if ('error' in prefs) {
      res.status(400).json({ error: prefs.error });
      return;
    }
    try {
      const spots = await cache.getOrLoad(cacheKey(search), () =>
        searchWatchSpots(config.googleApiKey, search, fetchFn),
      );
      const result = await recommendSpots(spots, prefs, gemini, fetchFn);
      res.json({ source: result.source, count: result.recommendations.length, recommendations: result.recommendations });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function parsePrefs(q: Record<string, string | undefined>): FanPrefs | { error: string } {
  for (const name of ['team', 'vibe'] as const) {
    const value = q[name];
    if (value !== undefined && (typeof value !== 'string' || !PREF_PATTERN.test(value))) {
      return { error: `${name} must be 1 to 40 letters, numbers, spaces or . ' & -` };
    }
  }
  if (q.is21 !== undefined && q.is21 !== 'true' && q.is21 !== 'false') {
    return { error: 'is21 must be true or false' };
  }
  // Only an explicit "true" counts as confirmed 21+.
  return { team: q.team, vibe: q.vibe, is21Plus: q.is21 === 'true' };
}
