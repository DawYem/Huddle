import { readError, UpstreamError } from './errors.js';

// Request body for https://developers.google.com/maps/documentation/geolocation/requests-geolocation
export interface GeolocateRequest {
  homeMobileCountryCode?: number;
  homeMobileNetworkCode?: number;
  radioType?: 'gsm' | 'cdma' | 'wcdma' | 'lte' | 'nr';
  carrier?: string;
  considerIp?: boolean;
  cellTowers?: Array<Record<string, unknown>>;
  wifiAccessPoints?: Array<Record<string, unknown>>;
}

export interface GeolocateResult {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

const ENDPOINT = 'https://www.googleapis.com/geolocation/v1/geolocate';

export async function geolocate(
  apiKey: string,
  request: GeolocateRequest,
  fetchFn: typeof fetch = fetch,
): Promise<GeolocateResult> {
  const res = await fetchFn(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new UpstreamError('Geolocation API', res.status, await readError(res));
  const body = (await res.json()) as { location: { lat: number; lng: number }; accuracy: number };
  return { lat: body.location.lat, lng: body.location.lng, accuracyMeters: body.accuracy };
}
