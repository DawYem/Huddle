import { Router } from 'express';
import type { Store } from '../huddle/store.js';
import { isEmail, toE164 } from '../huddle/phone.js';

const MAX_NAME = 40;

// POST /api/fans  { firstName, lastName, phone, email }
// The website's sign-up form. Saves the fan so the iMessage agent knows them
// when they text Huddle. Huddle never texts first, so the response says whether
// they still need to send that first text, and to which number.
export function fansRouter(store: Store, huddleNumber?: string): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
    const firstName = text('firstName');
    const lastName = text('lastName');
    const email = text('email');

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

    const existed = store.getFan(handle) !== undefined;
    const fan = store.upsertFan(handle, { name: `${firstName} ${lastName}`, email: email.toLowerCase() });
    res.status(existed ? 200 : 201).json({
      handle,
      created: !existed,
      textedHuddle: fan.textedFirst,
      huddleNumber: huddleNumber ?? null,
    });
  });

  return router;
}
