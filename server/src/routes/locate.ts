import { Router } from 'express';
import type { GeminiSettings } from '../gemini/client.js';
import { barsForSport, barsText, sportGames } from '../huddle/bars.js';
import type { Catalog } from '../huddle/catalog.js';
import { verifyLocationRequest } from '../huddle/locationLink.js';
import { sportById } from '../huddle/sports.js';
import type { SendTexts } from '../photon/send.js';

export interface LocateOptions {
  apiKey: string;
  linkSecret: string;
  catalog: Catalog;
  gemini?: GeminiSettings;
  fetchFn?: typeof fetch;
  // Texts the results back into the fan's iMessage chat.
  sendTexts?: SendTexts;
}

// GET  /api/locate?t=<token>          -> { sport } if the link is valid
// POST /api/locate { t, lat, lng }     -> bars for that sport, also texted to the fan
// The token comes from the iMessage agent; the fan's browser supplies lat/lng
// after they tap "Allow" on Safari's location prompt.
export function locateRouter(opts: LocateOptions): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const request = verifyLocationRequest(String(req.query.t ?? ''), opts.linkSecret);
    const sport = request && sportById(request.sport);
    if (!sport) {
      res.status(400).json({ error: 'This link is invalid or expired. Text Huddle for a new one.' });
      return;
    }
    res.json({ sport: { id: sport.id, label: sport.label } });
  });

  router.post('/', async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request = verifyLocationRequest(typeof body.t === 'string' ? body.t : '', opts.linkSecret);
    const sport = request && sportById(request.sport);
    if (!request || !sport) {
      res.status(400).json({ error: 'This link is invalid or expired. Text Huddle for a new one.' });
      return;
    }
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ error: 'lat and lng must be valid coordinates' });
      return;
    }

    try {
      const bars = await barsForSport(
        { apiKey: opts.apiKey, gemini: opts.gemini, fetchFn: opts.fetchFn },
        { lat, lng },
        sport,
        request.is21Plus,
      );
      let texted = false;
      if (opts.sendTexts) {
        try {
          await opts.sendTexts(request.handle, [barsText(sport, bars, sportGames(opts.catalog, sport, new Date()))]);
          texted = true;
        } catch (err) {
          console.error(`iMessage send failed for ${request.handle}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      res.json({
        sport: { id: sport.id, label: sport.label },
        texted,
        bars: bars.map((b) => ({ name: b.name, address: b.address, reason: b.reason, directionsUrl: b.directionsUrl })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
