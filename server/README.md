# Huddle server

Backend for Huddle. It keeps the Google API key off the client and absorbs traffic with caching and rate limiting.

## Setup

```sh
cd server
npm install
cp .env.example .env   # add a key with Geolocation API and Places API (New) enabled
npm run dev
```

`npm test` runs the test suite (Google is mocked), `npm run build && npm start` runs the compiled server.

## Endpoints

### `GET /api/spots`

Finds places nearby where people can watch a game together.

| Param | Default | Notes |
| --- | --- | --- |
| `lat`, `lng` | required | The user's position |
| `radius` | `2000` | Meters, up to 50000 |
| `types` | `bar,restaurant,cafe` | Comma-separated subset |
| `q` | none | Free text like `sports bar`; uses Text Search instead of Nearby Search |
| `limit` | `20` | 1 to 20 |

Returns `{ count, spots: [{ id, name, address, lat, lng, distanceMeters, primaryType, rating, ratingCount, openNow, googleMapsUri }] }`, nearest first.

### `GET /api/recommendations`

Up to 3 watch spots picked for one fan, each with a reason and a Google Maps directions link.

| Param | Default | Notes |
| --- | --- | --- |
| `lat`, `lng` | required | The user's position |
| `team`, `vibe` | none | Up to 40 letters, numbers, spaces or `. ' & -` |
| `is21` | `false` | Only `true` counts as confirmed 21+ |
| `radius`, `types`, `q`, `limit` | as `/api/spots` | Passed to the same Places search |

1. Searches Places exactly like `/api/spots` (and caches the same way).
2. If `is21` isn't `true`, drops bars, pubs, clubs and other alcohol-focused types, plus places with no type, before anything else sees them.
3. Asks Gemini to rank the remaining places. Gemini may only return ids from that list; anything else is discarded, and reasons that claim a venue is showing a game are replaced with plain facts (we have no showing data).
4. If `GEMINI_API_KEY` is unset, Gemini fails, or it returns nothing valid, falls back to open-now first, then nearest.

Returns `{ source: "gemini" | "fallback", count, recommendations: [{ ...spot fields, reason, directionsUrl }] }`. `directionsUrl` is a plain [Maps URL](https://developers.google.com/maps/documentation/urls/get-started) (no API key) that starts from the phone's current location.

### `POST /api/location`

Fallback for devices without a GPS fix. Send the Google Geolocation request body with `wifiAccessPoints` and/or `cellTowers`; returns `{ lat, lng, accuracyMeters }`. IP-based lookup is disabled, since from the server it would locate the server rather than the user. Clients that have GPS (browser `navigator.geolocation`, iOS/Android location) should send coordinates straight to `/api/spots`.

### `GET /health`

Returns `{ ok: true }`.

## Traffic handling

- Identical spot searches within about 110 m of each other share one cached result for `CACHE_TTL_SECONDS` (default 300), and concurrent identical searches share one Google call.
- `/api/*` is rate limited per IP to `RATE_LIMIT_PER_MINUTE` (default 60).
- Google 429s come back as 503 and other Google errors as 502, with Google's message in `detail`.
