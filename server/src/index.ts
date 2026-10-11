import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openHuddleData } from './huddle/data.js';

// The Express app, as Vercel expects: a default export it serves itself.
// `npm run dev` / `npm start` listen on a port through src/local.ts instead.
// (Don't add `export const config` here: Vercel reserves that name in function files.)
const app = createApp(loadConfig(), fetch, openHuddleData());

export default app;
