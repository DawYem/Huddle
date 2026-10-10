import type { GeminiSettings } from '../gemini/client.js';
import type { WatchSpot } from '../google/places.js';
import { directionsUrl } from '../maps/directions.js';
import { filterEligible, type FanPrefs } from './eligibility.js';
import { fallbackRank, rankWithGemini, type RankedSpot } from './rank.js';

export interface Recommendation extends WatchSpot {
  reason: string;
  directionsUrl: string;
}

export interface RecommendationResult {
  // "gemini" when Gemini's ranking was used, "fallback" when we used nearest-open.
  source: 'gemini' | 'fallback';
  recommendations: Recommendation[];
}

// 1. Drop venues this fan can't go to. 2. Ask Gemini to rank what's left.
// 3. If Gemini is off, fails, or returns nothing valid, use the deterministic fallback.
export async function recommendSpots(
  spots: WatchSpot[],
  prefs: FanPrefs,
  gemini: GeminiSettings | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<RecommendationResult> {
  const eligible = filterEligible(spots, prefs);

  let ranked: RankedSpot[] = [];
  if (gemini && eligible.length) {
    try {
      ranked = await rankWithGemini(eligible, prefs, gemini, fetchFn);
    } catch (err) {
      console.error(`Gemini ranking failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const source = ranked.length ? 'gemini' : 'fallback';
  if (!ranked.length) ranked = fallbackRank(eligible);

  return {
    source,
    recommendations: ranked.map(({ spot, reason }) => ({ ...spot, reason, directionsUrl: directionsUrl(spot) })),
  };
}
