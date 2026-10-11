import { Router } from 'express';
import { geocodeText } from '../google/places.js';
import { formatEventTime, newEvent, waitingFor } from '../huddle/community.js';
import { verifyLocationRequest } from '../huddle/locationLink.js';
import { sportById } from '../huddle/sports.js';
import type { Store } from '../huddle/store.js';
import type { SendTexts } from '../photon/send.js';

export interface EventsOptions {
  store: Store;
  apiKey: string;
  linkSecret?: string;
  fetchFn?: typeof fetch;
  sendTexts?: SendTexts;
}

const MAX_TEXT = 80;

// GET  /api/events/host?t=<token>   -> { sport, near } for the "list your venue" form
// POST /api/events                   { t?, hostName, venueName, address, sport, startsAt }
// Creates a community watch event at the venue's address and texts every fan
// waiting in the queue for that sport nearby.
export function eventsRouter(opts: EventsOptions): Router {
  const router = Router();

  router.get('/host', (req, res) => {
    const request = opts.linkSecret ? verifyLocationRequest(String(req.query.t ?? ''), opts.linkSecret) : undefined;
    const sport = request && sportById(request.sport);
    if (!sport) {
      res.status(400).json({ error: 'This link is invalid or expired. Text Huddle for a new one.' });
      return;
    }
    res.json({ sport: { id: sport.id, label: sport.label } });
  });

  router.post('/', async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
    const host = opts.linkSecret && text('t') ? verifyLocationRequest(text('t'), opts.linkSecret) : undefined;
    if (text('t') && !host) {
      res.status(400).json({ error: 'This link is invalid or expired. Text Huddle for a new one.' });
      return;
    }

    const errors: Record<string, string> = {};
    const hostName = text('hostName');
    const venueName = text('venueName');
    const address = text('address');
    const sport = sportById(text('sport'));
    const startsAt = new Date(text('startsAt'));
    if (!hostName || hostName.length > MAX_TEXT) errors.hostName = 'Enter your name.';
    if (!venueName || venueName.length > MAX_TEXT) errors.venueName = 'Enter the venue name.';
    if (!address || address.length > 200) errors.address = 'Enter the venue address.';
    if (!sport) errors.sport = 'Pick a sport.';
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 60 * 60 * 1000) {
      errors.startsAt = 'Pick a date and time that hasn\'t passed.';
    }
    if (Object.keys(errors).length || !sport) {
      res.status(400).json({ error: 'Some fields need fixing.', fields: errors });
      return;
    }

    try {
      const near = host?.lat !== undefined && host.lng !== undefined ? { lat: host.lat, lng: host.lng } : undefined;
      const place = await geocodeText(opts.apiKey, address, near, opts.fetchFn);
      if (!place) {
        res.status(400).json({ error: 'Some fields need fixing.', fields: { address: "We couldn't find that address." } });
        return;
      }

      const event = newEvent({
        sport: sport.id,
        venueName,
        address: place.label,
        lat: place.lat,
        lng: place.lng,
        startsAt: startsAt.toISOString(),
        hostName,
        hostHandle: host?.handle,
      });
      await opts.store.addEvent(event);

      // Text everyone waiting for this sport nearby, and let them reply YES.
      const waiting = waitingFor(await opts.store.waitlist(), event);
      let notified = 0;
      for (const w of waiting) {
        await opts.store.upsertFan(w.handle, {
          prompt: { type: 'community-join', sport: w.sport, lat: w.lat, lng: w.lng, at: new Date().toISOString() },
        });
        if (!opts.sendTexts) continue;
        try {
          await opts.sendTexts(w.handle, [
            `🎉 A ${sport.label.toLowerCase()} watch party was just listed near you: ${venueName}, ${formatEventTime(event)}, hosted by ${hostName}. Want to join? Reply YES.`,
          ]);
          notified++;
        } catch (err) {
          console.error(`waitlist text to ${w.handle} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await opts.store.removeFromWaitlist(waiting.map((w) => w.handle));

      res.status(201).json({ event, notified });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
