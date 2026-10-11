import type { GeminiSettings } from '../gemini/client.js';
import { searchWatchSpots } from '../google/places.js';
import { recommendSpots, type Recommendation } from '../recommendations/recommend.js';
import { upcomingGames, type Catalog } from './catalog.js';
import type { Sport } from './sports.js';
import type { Game } from './types.js';

const RADIUS_METERS = 3000;

// Bars near a point for one sport, ranked the same way as /api/recommendations
// (Gemini when configured, otherwise open-now then nearest).
export async function barsForSport(
  opts: { apiKey: string; gemini?: GeminiSettings; fetchFn?: typeof fetch },
  at: { lat: number; lng: number },
  sport: Sport,
  is21Plus: boolean,
): Promise<Recommendation[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const spots = await searchWatchSpots(
    opts.apiKey,
    { lat: at.lat, lng: at.lng, radiusMeters: RADIUS_METERS, types: ['bar', 'restaurant', 'cafe'], query: sport.query, maxResults: 10 },
    fetchFn,
  );
  const { recommendations } = await recommendSpots(spots, { team: sport.label, is21Plus }, opts.gemini, fetchFn);
  return recommendations;
}

export function sportGames(catalog: Catalog, sport: Sport, now: Date): Game[] {
  return upcomingGames(catalog, now).filter((g) => sport.leagues.includes(g.league)).slice(0, 2);
}

// The iMessage reply. We don't know what any venue is showing, so we say so.
export function barsText(sport: Sport, bars: Recommendation[], games: Game[] = []): string {
  if (!bars.length) return `I couldn't find bars for ${sport.label.toLowerCase()} near you. Try a nearby neighborhood name.`;
  const lines = [
    `🏟 ${sport.label} spots near you (call ahead to check they're showing your game):`,
    ...bars.map((b) => `• ${b.name}: ${b.reason}\n  ${b.directionsUrl}`),
  ];
  if (games.length) {
    lines.push('', `Huddle crews for ${sport.label.toLowerCase()}: ${games.map((g) => `${g.home} vs ${g.away} at ${g.venue.name}`).join('; ')}. Text "find ${games[0].home}" to join.`);
  }
  return lines.join('\n');
}
