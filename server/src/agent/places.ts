import { TtlCache } from '../cache.js';
import type { GeminiSettings } from '../gemini/client.js';
import { geocodeText, searchWatchSpots, type SpotSearch, type WatchSpot } from '../google/places.js';
import { barsForSport, barsText, sportGames } from '../huddle/bars.js';
import type { Sport } from '../huddle/sports.js';
import { perkFor, type Catalog } from '../huddle/catalog.js';
import type { Fan, Perk, Venue } from '../huddle/types.js';
import { directionsUrl } from '../maps/directions.js';
import { filterEligible } from '../recommendations/eligibility.js';
import { recommendSpots, type Recommendation } from '../recommendations/recommend.js';
import { cacheKey } from '../routes/spots.js';

const FOOD_RADIUS_METERS = 800;
const WATCH_RADIUS_METERS = 3000;
const MAX_SUGGESTIONS = 3;

export interface FoodSpot extends WatchSpot {
  directionsUrl: string;
  perk?: Perk;
}

// What the agent needs from Google. Tests swap in a fake.
export interface PlacesFinder {
  foodNear(venue: Venue, fan: Fan): Promise<FoodSpot[]>;
  watchSpotsNear(lat: number, lng: number, fan: Fan): Promise<Recommendation[]>;
  // Ready-to-send text listing bars for a sport near a point.
  barsNear(lat: number, lng: number, sport: Sport, fan: Fan): Promise<string>;
  geocode(text: string, near?: { lat: number; lng: number }): Promise<{ lat: number; lng: number; label: string } | undefined>;
}

export function googlePlacesFinder(
  apiKey: string,
  catalog: Catalog,
  opts: { cacheTtlMs: number; gemini?: GeminiSettings; fetchFn?: typeof fetch },
): PlacesFinder {
  const fetchFn = opts.fetchFn ?? fetch;
  const cache = new TtlCache<WatchSpot[]>(opts.cacheTtlMs);
  const search = (s: SpotSearch) => cache.getOrLoad(cacheKey(s), () => searchWatchSpots(apiKey, s, fetchFn));

  return {
    async foodNear(venue, fan) {
      const spots = await search({
        lat: venue.lat,
        lng: venue.lng,
        radiusMeters: FOOD_RADIUS_METERS,
        types: ['restaurant', 'cafe'],
        maxResults: 20,
      });
      return rankFood(spots, venue, fan, catalog);
    },
    async barsNear(lat, lng, sport, fan) {
      const bars = await barsForSport({ apiKey, gemini: opts.gemini, fetchFn }, { lat, lng }, sport, fan.is21Plus);
      return barsText(sport, bars, sportGames(catalog, sport, new Date()));
    },
    geocode(text, near) {
      return geocodeText(apiKey, text, near, fetchFn);
    },
    async watchSpotsNear(lat, lng, fan) {
      const spots = await search({
        lat,
        lng,
        radiusMeters: WATCH_RADIUS_METERS,
        types: ['bar', 'restaurant', 'cafe'],
        query: 'sports bar',
        maxResults: 10,
      });
      const { recommendations } = await recommendSpots(
        spots,
        { team: fan.favoriteTeam, is21Plus: fan.is21Plus },
        opts.gemini,
        fetchFn,
      );
      return recommendations;
    },
  };
}

// Partner perks first, then open now, then nearest. Never the venue itself,
// and the same 21+ rule as /api/recommendations.
export function rankFood(spots: WatchSpot[], venue: Venue, fan: Fan, catalog: Catalog): FoodSpot[] {
  return filterEligible(
    spots.filter((s) => s.id !== venue.placeId),
    { is21Plus: fan.is21Plus },
  )
    .map((s) => ({ ...s, directionsUrl: directionsUrl(s), perk: perkFor(catalog, s.id) }))
    .sort(
      (a, b) =>
        Number(!!b.perk) - Number(!!a.perk) ||
        Number(b.openNow === true) - Number(a.openNow === true) ||
        a.distanceMeters - b.distanceMeters,
    )
    .slice(0, MAX_SUGGESTIONS);
}
