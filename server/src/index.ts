import express from 'express';
import { createApp } from './createApp.js';
import { loadConfig } from './config.js';
import { openHuddleData } from './huddle/data.js';

// The Express app, as Vercel expects: a default export it serves itself.
// `npm run dev` / `npm start` listen on a port through src/local.ts instead.
// (Don't add `export const config` here: Vercel reserves that name in function files.)
function build(): express.Express {
  try {
    return createApp(loadConfig(), fetch, openHuddleData());
  } catch (err) {
    // Answer every request with the startup error instead of a bare crash,
    // so a broken deploy says what's wrong.
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Huddle server failed to start: ${detail}`);
    const broken = express();
    broken.use((_req, res) => {
      res.status(500).json({ error: 'Server failed to start', detail });
    });
    return broken;
  }
}

const app = build();
export default app;
