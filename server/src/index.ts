import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openHuddleData } from './huddle/data.js';

const config = loadConfig();
createApp(config, fetch, openHuddleData()).listen(config.port, () => {
  console.log(`Huddle server listening on :${config.port}`);
});
