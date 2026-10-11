import app from './index.js';
import { loadConfig } from './config.js';

// Local server for `npm run dev` and `npm start`. On Vercel, src/index.ts's
// default export is served directly and this file isn't used.
const { port } = loadConfig();
app.listen(port, () => {
  console.log(`Huddle server listening on :${port}`);
});
