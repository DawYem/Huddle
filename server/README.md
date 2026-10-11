# Huddle server

Backend for Huddle. It keeps the Google API key off the client and absorbs traffic with caching and rate limiting.

## Setup

```sh
cd server
npm install
cp .env.example .env   # add a key with Geolocation API and Places API (New) enabled
npm run dev            # http://localhost:4000
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

### `POST /api/fans`

The website sign-up. Body: `{ firstName, lastName, phone, email }`. `phone` can be typed any common way ("(404) 555-0123"); it is stored as E.164 (`+14045550123`), the handle iMessage uses, with US/Canada assumed when there is no country code. Returns 201 for a new fan, 200 for an update, or 400 with per-field messages in `fields`.

When `SPECTRUM_PROJECT_ID`/`SPECTRUM_PROJECT_SECRET` are set, the same four fields are also sent to Photon's [Create user](https://photon.codes/docs/api-reference/users/create-user) API, so the fan appears in the Photon dashboard's **Users** list (`firstName`, `lastName`, `phoneNumber`, `email`). On the shared plan Photon only delivers to registered users, so this is what lets the agent text them. Signing up again updates that user. The sign-up is saved locally first; if Photon fails, the error is logged, `spectrumSynced` is `false`, and the next sign-up retries.

The response includes `textedHuddle` and `huddleNumber`: the number Photon assigned the fan, or `HUDDLE_NUMBER` as a fallback, so the site can ask them to send the first text. Set `SPECTRUM_USER_TYPE=dedicated` on the Business plan, which registers fans against the `HUDDLE_NUMBER` line.

### `GET /api/games`

Upcoming games, soonest first. `team` (optional) filters by name or alias, e.g. `?team=knicks`.

### `POST /api/games/:id/signups`

Signs a fan up for a game. Body: `{ handle, name?, is21Plus?, lat?, lng? }`, where `handle` is an E.164 phone number or an email (the two iMessage handle types). Returns 201 for a new sign-up and 200 if they were already in. `textedHuddle: false` means the agent won't text them yet; the site should prompt them to text Huddle first.

## Traffic handling

- Identical spot searches within about 110 m of each other share one cached result for `CACHE_TTL_SECONDS` (default 300), and concurrent identical searches share one Google call.
- `/api/*` is rate limited per IP to `RATE_LIMIT_PER_MINUTE` (default 60).
- Google 429s come back as 503 and other Google errors as 502, with Google's message in `detail`.

## iMessage agent (Photon Spectrum)

`npm run agent` starts the Huddle agent, built on Photon's open source [Spectrum SDK](https://photon.codes/docs/spectrum-ts/introduction) (`spectrum-ts`). It shares the data files with the HTTP server.

- **No Photon credentials yet:** it opens Spectrum's terminal chat, where you are the seed demo fan (`+15555550100`). Try `find Knicks`, `2`, `yes`, `find the Lakers game`, `my games`, `/remind`.
- **iMessage:** set `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` (app.photon.codes, project Settings) in `.env`. Set `AGENT_TERMINAL=true` to keep the terminal chat as well.

What it does:

1. **Can't find a game?** Text a team (`I can't find the Knicks game`). It lists that team's crews to join by number. If there are none, it offers other upcoming crews plus nearby sports bars from `/api/recommendations` ranking (told to call ahead, since we don't know what a venue is showing).
2. **Reminders.** Texts signed-up fans `REMINDER_HOURS` before kickoff (default 24 and 2) with time, venue and directions. If the venue doesn't serve food, it adds up to 3 food spots within 800 m, partner perks first. Under-21 fans never get bars.
3. **Calendar.** Every reminder and sign-up asks "Want it on your calendar?". YES sends a `.ics` invite (opens in Apple Calendar from iMessage) and a Google Calendar link.

Safety rules from the landing page: the agent only texts fans who texted Huddle first, `stop` pauses all texts until `start`, and `report` is logged for a person to review.

### Data

| File | What | In git |
| --- | --- | --- |
| `data/games.json` | Games and team aliases. Venues are real Places listings; the games, times and `servesFood` values are sample data. | yes |
| `data/perks.json` | Partner perks keyed by Places id. **Sample perks, not real offers.** Replace with signed deals before texting real fans. | yes |
| `data/store.seed.json` | Starting fans and sign-ups, copied to `store.json` on first run. | yes |
| `data/store.json` | Live fans, sign-ups and sent reminders. Delete it to reset the demo. | no |

`store.json` is a single JSON file shared by the server and the agent, which is fine for a demo; move it to a database before real traffic. `HUDDLE_DATA_DIR` points both processes at another folder.
