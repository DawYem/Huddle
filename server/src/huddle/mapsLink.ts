// Pulls coordinates out of what a fan might send: an iMessage location pin
// (a vCard holding a maps.apple.com link), a pasted Apple/Google Maps link,
// or plain "40.75, -73.99".
export interface LatLng {
  lat: number;
  lng: number;
}

const PATTERNS = [
  // maps.apple.com/?ll=40.75,-73.99 and Google's ?q= / &query= / ll=
  /[?&](?:ll|q|query|sll|daddr|center)=(-?\d{1,2}(?:\.\d+)?)(?:%2C|,)\s*(-?\d{1,3}(?:\.\d+)?)/i,
  // google.com/maps/@40.75,-73.99,15z and /place/.../@40.75,-73.99
  /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
  // bare "40.7505, -73.9934"
  /(?:^|[^\d.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?:$|[^\d])/,
];

export function extractLatLng(text: string | undefined): LatLng | undefined {
  if (!text) return undefined;
  // vCards escape commas ("ll=40.75\,-73.99"); JSON doubles that backslash.
  const normalized = text.replace(/\\+,/g, ',');
  for (const re of PATTERNS) {
    const m = re.exec(normalized);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return undefined;
}
