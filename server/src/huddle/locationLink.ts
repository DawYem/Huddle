import { createHmac, timingSafeEqual } from 'node:crypto';

// The private link the agent texts so a fan can share their location from
// Safari. It's signed, so nobody can make a link that texts someone else's
// number, and it expires.
export interface LocationRequest {
  handle: string; // the fan's iMessage handle (E.164)
  sport: string; // sport id from sports.ts
  is21Plus: boolean;
  // Set on host links, so the venue form can look up addresses nearby.
  lat?: number;
  lng?: number;
  exp: number; // ms since epoch
}

const TTL_MS = 60 * 60 * 1000;

export function signLocationRequest(
  req: Omit<LocationRequest, 'exp'>,
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify({ ...req, exp: now + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyLocationRequest(token: string, secret: string, now = Date.now()): LocationRequest | undefined {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return undefined;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const req = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocationRequest;
    if (typeof req.handle !== 'string' || typeof req.sport !== 'string' || typeof req.exp !== 'number') return undefined;
    return req.exp > now ? req : undefined;
  } catch {
    return undefined;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', `huddle-location:${secret}`).update(payload).digest('base64url');
}
