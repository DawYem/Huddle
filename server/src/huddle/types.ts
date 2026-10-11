// A place a Huddle crew meets to watch a game.
export interface Venue {
  name: string;
  address: string;
  lat: number;
  lng: number;
  // Google Places id, so perks and directions line up with Places results.
  placeId?: string;
  // False means the agent suggests nearby food when it reminds fans.
  servesFood: boolean;
}

export interface Game {
  id: string;
  league: string;
  home: string;
  away: string;
  // ISO 8601 with offset, e.g. "2026-10-11T19:30:00-04:00".
  startsAt: string;
  // IANA zone of the venue, used for every time we show the fan.
  timeZone: string;
  durationMinutes: number;
  venue: Venue;
}

// Someone who signed up on the website or texted Huddle.
export interface Fan {
  // iMessage handle: E.164 phone number or email.
  handle: string;
  name?: string;
  email?: string;
  // True only when the fan's 21+ status is confirmed.
  is21Plus: boolean;
  favoriteTeam?: string;
  // Where to search for spots when the fan has no game nearby.
  lat?: number;
  lng?: number;
  // The landing page promises Huddle only texts people who texted it first.
  // Set the first time the fan messages the agent.
  textedFirst: boolean;
  // Set by "stop"; no reminders until the fan texts "start".
  optedOut: boolean;
}

export interface Signup {
  gameId: string;
  handle: string;
  createdAt: string;
}

// A deal a partner venue offers Huddle fans, keyed by Google Places id.
export interface Perk {
  placeId: string;
  name: string;
  perk: string;
}
