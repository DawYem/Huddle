import { randomUUID } from 'node:crypto';
import { haversineMeters } from '../google/places.js';
import { directionsUrl } from '../maps/directions.js';
import { sportById } from './sports.js';
import type { CommunityEvent, WaitlistEntry } from './types.js';

// How far a fan will go for a watch party, and how long after kickoff an event
// still counts as joinable.
export const COMMUNITY_RADIUS_METERS = 8000;
const JOINABLE_AFTER_START_MS = 2 * 60 * 60 * 1000;

export interface NearbyEvent {
  event: CommunityEvent;
  distanceMeters: number;
}

export function eventsNear(
  events: CommunityEvent[],
  at: { lat: number; lng: number },
  sport: string,
  now: Date,
): NearbyEvent[] {
  return events
    .filter((e) => e.sport === sport && new Date(e.startsAt).getTime() + JOINABLE_AFTER_START_MS > now.getTime())
    .map((event) => ({ event, distanceMeters: Math.round(haversineMeters(at.lat, at.lng, event.lat, event.lng)) }))
    .filter((n) => n.distanceMeters <= COMMUNITY_RADIUS_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}

// Waiting fans an event should be offered to.
export function waitingFor(waitlist: WaitlistEntry[], event: CommunityEvent): WaitlistEntry[] {
  return waitlist.filter(
    (w) =>
      w.sport === event.sport &&
      w.handle !== event.hostHandle &&
      haversineMeters(w.lat, w.lng, event.lat, event.lng) <= COMMUNITY_RADIUS_METERS,
  );
}

export function newEvent(fields: Omit<CommunityEvent, 'id' | 'attendees' | 'createdAt'>, now = new Date()): CommunityEvent {
  return {
    ...fields,
    id: randomUUID(),
    attendees: fields.hostHandle ? [fields.hostHandle] : [],
    createdAt: now.toISOString(),
  };
}

export function formatEventTime(event: CommunityEvent): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(event.startsAt));
}

export function eventLine({ event, distanceMeters }: NearbyEvent, index: number): string {
  const sport = sportById(event.sport)?.label ?? event.sport;
  const going = event.attendees.length;
  return `${index + 1}. ${sport} at ${event.venueName} (${(distanceMeters / 1609).toFixed(1)} mi), ${formatEventTime(event)}, hosted by ${event.hostName}${going ? `, ${going} going` : ''}`;
}

export function joinedText(event: CommunityEvent): string {
  return [
    `🎉 You're in! ${sportById(event.sport)?.label ?? ''} watch party at ${event.venueName}`.replace('  ', ' '),
    `🗓 ${formatEventTime(event)}`,
    `📍 ${event.address}`,
    `Hosted by ${event.hostName}. ${event.attendees.length} going.`,
    `Directions: ${directionsUrl({ id: '', lat: event.lat, lng: event.lng }).replace('&destination_place_id=', '')}`,
  ].join('\n');
}
