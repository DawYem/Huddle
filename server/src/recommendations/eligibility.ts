import type { WatchSpot } from '../google/places.js';

export interface FanPrefs {
  team?: string;
  vibe?: string;
  // True only when the fan's 21+ status is confirmed.
  is21Plus: boolean;
}

// Places doesn't tell us whether a venue admits under-21s. So for fans whose age
// isn't confirmed, we skip every alcohol-focused type (Places API (New) Table A)
// and any place with no type at all. Better to miss a venue than send a minor to a bar.
export const ALCOHOL_FOCUSED_TYPES = new Set([
  'bar',
  'bar_and_grill',
  'beer_garden',
  'brewery',
  'brewpub',
  'cocktail_bar',
  'gastropub',
  'hookah_bar',
  'irish_pub',
  'lounge_bar',
  'pub',
  'sports_bar',
  'wine_bar',
  'winery',
  'night_club',
  'comedy_club',
  'dance_hall',
  'karaoke',
  'live_music_venue',
]);

// Runs before Gemini sees anything, so Gemini can only ever pick eligible venues.
export function filterEligible(spots: WatchSpot[], prefs: FanPrefs): WatchSpot[] {
  if (prefs.is21Plus) return spots;
  return spots.filter((s) => s.primaryType !== undefined && !ALCOHOL_FOCUSED_TYPES.has(s.primaryType));
}
