# Huddle

Game day is a team sport. Huddle texts fans before their team plays and puts them at a table with a small crew nearby.

| Folder | What | Port |
| --- | --- | --- |
| `/` (`app/`) | Next.js site: landing page and sign-up | 3000 |
| `server/` | Express API and the iMessage agent (Photon Spectrum). See [server/README.md](server/README.md) | 4000 |

## Run it locally

```sh
# API (needs server/.env, see server/.env.example)
cd server && npm install && npm run dev

# Site, in a second terminal from the repo root
npm install && npm run dev

# Optional: the iMessage agent, in a third terminal
cd server && npm run agent
```

The site calls `/api/*` on itself and Next.js forwards it to the API (`next.config.ts`), so the browser never needs the server's address. Set `HUDDLE_API_URL` to point the site at a deployed API instead of `http://localhost:4000`.

The sign-up form posts to `POST /api/fans`. Huddle only texts people who texted it first, so after signing up the site asks the fan to text Huddle; set `HUDDLE_NUMBER` in `server/.env` to show the number there.
