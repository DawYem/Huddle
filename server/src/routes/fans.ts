import { Router } from 'express';
import type { RegisterSpectrumUser } from '../photon/users.js';
import type { Store } from '../huddle/store.js';
import { isEmail, toE164 } from '../huddle/phone.js';

const MAX_NAME = 40;

export interface FansRouterOptions {
  // Fallback number to show when Photon isn't connected or didn't answer.
  huddleNumber?: string;
  // Adds the fan to the Photon dashboard's Users list.
  registerSpectrumUser?: RegisterSpectrumUser;
}

// POST /api/fans  { firstName, lastName, phone, email }
// The website's sign-up form. Saves the fan so the iMessage agent knows them,
// and registers the same fields as a user in the Photon (Spectrum) project.
// Huddle never texts first, so the response says whether they still need to
// send that first text, and to which number.
export function fansRouter(store: Store, opts: FansRouterOptions = {}): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
    const firstName = text('firstName');
    const lastName = text('lastName');
    const email = text('email').toLowerCase();

    const errors: Record<string, string> = {};
    if (!firstName || firstName.length > MAX_NAME) errors.firstName = 'Enter your first name.';
    if (!lastName || lastName.length > MAX_NAME) errors.lastName = 'Enter your last name.';
    const handle = toE164(text('phone'));
    if (!handle) errors.phone = 'Enter a valid phone number, like (404) 555-0123.';
    if (!isEmail(email)) errors.email = 'Enter a valid email.';
    if (!handle || Object.keys(errors).length) {
      res.status(400).json({ error: 'Some fields need fixing.', fields: errors });
      return;
    }

    try {
      const existed = await store.getFan(handle) !== undefined;
      let fan = await store.upsertFan(handle, { name: `${firstName} ${lastName}`, email });

      // Saved locally first, so a Photon outage never loses a sign-up.
      // Signing up again retries, since Photon updates users by phone number.
      let spectrumSynced = false;
      if (opts.registerSpectrumUser) {
        try {
          const user = await opts.registerSpectrumUser({ phoneNumber: handle, firstName, lastName, email });
          fan = await store.upsertFan(handle, { spectrumUserId: user.id, huddleNumber: user.assignedPhoneNumber });
          spectrumSynced = true;
        } catch (err) {
          console.error(`Photon user sync failed for ${handle}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      res.status(existed ? 200 : 201).json({
        handle,
        created: !existed,
        textedHuddle: fan.textedFirst,
        huddleNumber: fan.huddleNumber ?? opts.huddleNumber ?? null,
        spectrumSynced,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
