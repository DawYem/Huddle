import { Router } from 'express';
import { publicCrew, verifyCrew } from '../huddle/crews.js';
import type { Store } from '../huddle/store.js';

// GET /api/crews/:id[?c=<signed snapshot>]
// The crew page's data: venue, sport and members' first names (never phone
// numbers). Reads the shared store; falls back to the signed snapshot from the
// crew link when this server can't see the agent's data.
export function crewsRouter(store: Store, linkSecret?: string): Router {
  const router = Router();

  router.get('/:id', async (req, res, next) => {
    try {
      const crew = await store.crew(req.params.id);
      if (crew) {
        res.json({ crew: publicCrew(crew), source: 'live' });
        return;
      }
      const token = typeof req.query.c === 'string' ? req.query.c : '';
      const snapshot = token && linkSecret ? verifyCrew(token, linkSecret) : undefined;
      if (snapshot && snapshot.id === req.params.id) {
        res.json({ crew: snapshot, source: 'link' });
        return;
      }
      res.status(404).json({ error: 'Crew not found' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
