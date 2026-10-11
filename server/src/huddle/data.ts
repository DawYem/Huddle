import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Imported (not read by path) so Vercel's bundler ships them with the function.
import games from '../../data/games.json' with { type: 'json' };
import perks from '../../data/perks.json' with { type: 'json' };
import seed from '../../data/store.seed.json' with { type: 'json' };
import { catalogFrom, loadCatalog, type Catalog, type GamesFile, type PerksFile } from './catalog.js';
import { Store } from './store.js';
import type { Fan, Signup } from './types.js';

// server/data, from both src/huddle (tsx) and dist/src/huddle (compiled).
const DEFAULT_DATA_DIR = fileURLToPath(
  new URL(import.meta.url.includes('/dist/') ? '../../../data' : '../../data', import.meta.url),
);

// Vercel functions can only write to /tmp, which is per instance and wiped on
// cold starts. Fine for a demo deploy; Photon's Users list keeps the durable
// copy of every sign-up. Move to a database before real traffic.
function defaultStorePath(): string {
  if (process.env.HUDDLE_STORE_PATH) return process.env.HUDDLE_STORE_PATH;
  if (process.env.VERCEL) return '/tmp/huddle-store.json';
  return join(DEFAULT_DATA_DIR, 'store.json');
}

// The HTTP server and the agent open the same files, so they see the same sign-ups.
// HUDDLE_DATA_DIR swaps in a different folder of games/perks/seed files.
export function openHuddleData(dataDir = process.env.HUDDLE_DATA_DIR): {
  catalog: Catalog;
  store: Store;
} {
  if (dataDir) {
    return {
      catalog: loadCatalog(join(dataDir, 'games.json'), join(dataDir, 'perks.json')),
      store: new Store(join(dataDir, 'store.json'), join(dataDir, 'store.seed.json')),
    };
  }
  return {
    catalog: catalogFrom(games as GamesFile, perks as PerksFile),
    store: new Store(defaultStorePath(), seed as { fans: Fan[]; signups: Signup[] }),
  };
}
