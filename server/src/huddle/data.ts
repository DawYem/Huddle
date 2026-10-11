import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, type Catalog } from './catalog.js';
import { Store } from './store.js';

// server/data, from both src/huddle (tsx) and dist/huddle (compiled).
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));

// The HTTP server and the agent open the same files, so they see the same sign-ups.
export function openHuddleData(dataDir = process.env.HUDDLE_DATA_DIR || DEFAULT_DATA_DIR): {
  catalog: Catalog;
  store: Store;
} {
  return {
    catalog: loadCatalog(join(dataDir, 'games.json'), join(dataDir, 'perks.json')),
    store: new Store(join(dataDir, 'store.json'), join(dataDir, 'store.seed.json')),
  };
}
