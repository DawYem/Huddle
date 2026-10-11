import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { haversineMeters } from '../google/places.js';
import { sportById } from './sports.js';
import type { BarPick, Crew, Fan } from './types.js';

// A crew is small enough to actually talk (the landing page promises 4 to 6),
// and only fans heading to the same bar for the same sport around the same
// time are grouped.
export const MAX_CREW = 6;
const CREW_WINDOW_MS = 12 * 60 * 60 * 1000;
const SAME_SPOT_METERS = 100;
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Finds an open crew for this bar and sport, if there is one.
export function openCrewFor(crews: Crew[], bar: BarPick, sport: string, handle: string, now: Date): Crew | undefined {
  return crews.find(
    (c) =>
      c.sport === sport &&
      now.getTime() - new Date(c.createdAt).getTime() < CREW_WINDOW_MS &&
      (c.members.length < MAX_CREW || c.members.some((m) => m.handle === handle)) &&
      (bar.id ? c.placeId === bar.id : haversineMeters(c.lat, c.lng, bar.lat, bar.lng) < SAME_SPOT_METERS),
  );
}

export function newCrew(bar: BarPick, sport: string, now: Date): Crew {
  return {
    id: randomBytes(6).toString('base64url'),
    sport,
    venueName: bar.name,
    address: bar.address,
    lat: bar.lat,
    lng: bar.lng,
    placeId: bar.id || undefined,
    members: [],
    createdAt: now.toISOString(),
  };
}

// "Sam Lee" -> "Sam L.": enough for a crew list, never a phone number.
export function displayName(fan: Pick<Fan, 'name'>): string {
  const parts = (fan.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Huddle fan';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

// What the crew page shows. No phone numbers.
export interface PublicCrew {
  id: string;
  sport: string;
  sportLabel: string;
  venueName: string;
  address?: string;
  members: string[];
  createdAt: string;
}

export function publicCrew(crew: Crew): PublicCrew {
  return {
    id: crew.id,
    sport: crew.sport,
    sportLabel: sportById(crew.sport)?.label ?? crew.sport,
    venueName: crew.venueName,
    address: crew.address,
    members: crew.members.map((m) => m.name),
    createdAt: crew.createdAt,
  };
}

// The crew link carries a signed snapshot, so the page can render it even when
// the website and the agent don't share storage yet.
export function signCrew(crew: PublicCrew, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...crew, exp: now + LINK_TTL_MS })).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyCrew(token: string, secret: string, now = Date.now()): PublicCrew | undefined {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return undefined;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const { exp, ...crew } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PublicCrew & { exp: number };
    return exp > now ? crew : undefined;
  } catch {
    return undefined;
  }
}

function mac(payload: string, secret: string): string {
  return createHmac('sha256', `huddle-crew:${secret}`).update(payload).digest('base64url');
}

export function crewText(crew: Crew, link: string | undefined, sportLabel: string): string {
  const others = crew.members.length - 1;
  return [
    `🙌 You're matched! ${others ? `You and ${others} other fan${others === 1 ? '' : 's'} are` : "You're the first fan"} watching ${sportLabel.toLowerCase()} at ${crew.venueName}.`,
    others ? '' : "I'll add fans who pick the same spot to your crew.",
    link ? `See your crew: ${link}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
