import { readError, UpstreamError } from './errors.js';

// Place types a group can watch a game at. Values are Places API (New) Table A types.
export const WATCH_SPOT_TYPES = ['bar', 'restaurant', 'cafe'] as const;
export type WatchSpotType = (typeof WATCH_SPOT_TYPES)[number];

export interface SpotSearch {
  lat: number;
  lng: number;
  radiusMeters: number;
  types: WatchSpotType[];
  // Free-text query such as "sports bar"; switches to Text Search when present.
  query?: string;
  maxResults: number;
}

export interface WatchSpot {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  primaryType?: string;
  rating?: number;
  ratingCount?: number;
  openNow?: boolean;
  googleMapsUri?: string;
}

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location: { latitude: number; longitude: number };
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
}

const BASE = 'https://places.googleapis.com/v1/places';

// Only the fields the app shows. Each field pulls in a billing tier, so keep this tight.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.rating',
  'places.userRatingCount',
  'places.currentOpeningHours.openNow',
  'places.googleMapsUri',
].join(',');

export async function searchWatchSpots(
  apiKey: string,
  search: SpotSearch,
  fetchFn: typeof fetch = fetch,
): Promise<WatchSpot[]> {
  const circle = {
    center: { latitude: search.lat, longitude: search.lng },
    radius: search.radiusMeters,
  };

  const [url, body] = search.query
    ? [
        `${BASE}:searchText`,
        {
          textQuery: search.query,
          pageSize: search.maxResults,
          locationBias: { circle },
        },
      ]
    : [
        `${BASE}:searchNearby`,
        {
          includedTypes: search.types,
          maxResultCount: search.maxResults,
          rankPreference: 'DISTANCE',
          locationRestriction: { circle },
        },
      ];

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new UpstreamError('Places API', res.status, await readError(res));

  const { places = [] } = (await res.json()) as { places?: GooglePlace[] };
  return places
    .map((p) => toWatchSpot(p, search.lat, search.lng))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function toWatchSpot(p: GooglePlace, lat: number, lng: number): WatchSpot {
  return {
    id: p.id,
    name: p.displayName?.text ?? 'Unnamed place',
    address: p.formattedAddress,
    lat: p.location.latitude,
    lng: p.location.longitude,
    distanceMeters: Math.round(haversineMeters(lat, lng, p.location.latitude, p.location.longitude)),
    primaryType: p.primaryType,
    rating: p.rating,
    ratingCount: p.userRatingCount,
    openNow: p.currentOpeningHours?.openNow,
    googleMapsUri: p.googleMapsUri,
  };
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Turns "Midtown Manhattan" or "near Penn Station" into coordinates with the
// same Places Text Search the app already uses (no separate Geocoding API).
export async function geocodeText(
  apiKey: string,
  text: string,
  near?: { lat: number; lng: number },
  fetchFn: typeof fetch = fetch,
): Promise<{ lat: number; lng: number; label: string } | undefined> {
  const res = await fetchFn(`${BASE}:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.location,places.formattedAddress,places.displayName',
    },
    body: JSON.stringify({
      textQuery: text,
      pageSize: 1,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50_000 } } } : {}),
    }),
  });
  if (!res.ok) throw new UpstreamError('Places API', res.status, await readError(res));
  const { places = [] } = (await res.json()) as { places?: GooglePlace[] };
  const p = places[0];
  if (!p) return undefined;
  return {
    lat: p.location.latitude,
    lng: p.location.longitude,
    label: p.formattedAddress ?? p.displayName?.text ?? text,
  };
}
