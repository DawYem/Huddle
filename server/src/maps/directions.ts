import type { WatchSpot } from '../google/places.js';

// Google Maps URLs need no API key or SDK: https://developers.google.com/maps/documentation/urls/get-started
// We leave out `origin` so Maps starts from the phone's own location, which also
// keeps the fan's coordinates out of a link that may be texted or shared.
export function directionsUrl(spot: Pick<WatchSpot, 'id' | 'lat' | 'lng'>): string {
  const params = new URLSearchParams({
    api: '1',
    // destination_place_id only works when destination is also set.
    destination: `${spot.lat},${spot.lng}`,
    destination_place_id: spot.id,
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
