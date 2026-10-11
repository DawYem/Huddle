import { Router } from 'express';
import { findGame, findTeams, upcomingGames, type Catalog } from '../huddle/catalog.js';
import { isEmail, toE164 } from '../huddle/phone.js';
import type { Store } from '../huddle/store.js';

// GET  /api/games[?team=Knicks]        upcoming games, soonest first
// POST /api/games/:id/signups          { handle, name?, is21Plus?, lat?, lng? }
export function gamesRouter(catalog: Catalog, store: Store): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const team = typeof req.query.team === 'string' ? req.query.team : undefined;
    let games = upcomingGames(catalog, new Date());
    if (team) {
      const teams = findTeams(catalog, team);
      games = games.filter((g) => teams.includes(g.home) || teams.includes(g.away));
    }
    res.json({ count: games.length, games });
  });

  router.post('/:id/signups', async (req, res, next) => {
    try {
    const game = findGame(catalog, req.params.id);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Phone (any common format) or email: the two handle types iMessage uses.
    const raw = typeof body.handle === 'string' ? body.handle.trim() : '';
    const handle = toE164(raw) ?? (isEmail(raw) ? raw.toLowerCase() : undefined);
    if (!handle) {
      res.status(400).json({ error: 'handle must be a phone number like (404) 555-0123 or +15551234567, or an email' });
      return;
    }
    const lat = body.lat === undefined ? undefined : Number(body.lat);
    const lng = body.lng === undefined ? undefined : Number(body.lng);
    if ((lat !== undefined || lng !== undefined) && !validLatLng(lat, lng)) {
      res.status(400).json({ error: 'lat and lng must be sent together as valid coordinates' });
      return;
    }

    const existing = await store.getFan(handle);
    await store.upsertFan(handle, {
      ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim().slice(0, 60) } : {}),
      // Only an explicit true confirms 21+; never downgrade a confirmed fan from a later form.
      is21Plus: body.is21Plus === true || existing?.is21Plus === true,
      ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
    });
    const created = await store.addSignup(game.id, handle);
    res.status(created ? 201 : 200).json({
      gameId: game.id,
      handle,
      created,
      // Huddle only texts fans who texted it first; the site should prompt them to.
      textedHuddle: (await store.getFan(handle))?.textedFirst ?? false,
    });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function validLatLng(lat?: number, lng?: number): boolean {
  return (
    lat !== undefined &&
    lng !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}
