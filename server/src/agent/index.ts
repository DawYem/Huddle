import { attachment, Spectrum, type Space } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { terminal } from 'spectrum-ts/providers/terminal';
import { loadConfig } from '../config.js';
import { openHuddleData } from '../huddle/data.js';
import { HuddleAgent, type Reply } from './brain.js';
import { googlePlacesFinder } from './places.js';
import { DEFAULT_WINDOWS_HOURS, dueReminders } from './reminders.js';

const config = loadConfig();
if (!config.googleApiKey) throw new Error('GOOGLE_MAPS_API_KEY is not set. Copy .env.example to .env and fill it in.');
const env = process.env;

// iMessage turns on once the Photon project credentials are in .env.
// Without them the agent runs in Spectrum's terminal chat for local testing.
const useIMessage = Boolean(env.SPECTRUM_PROJECT_ID && env.SPECTRUM_PROJECT_SECRET);
const useTerminal = !useIMessage || env.AGENT_TERMINAL === 'true';
// Terminal chats have no phone number, so they act as this fan (the seed demo fan by default).
const terminalHandle = env.AGENT_TERMINAL_HANDLE || '+15555550100';
const windowsHours = env.REMINDER_HOURS
  ? env.REMINDER_HOURS.split(',').map(Number).filter((h) => h > 0)
  : DEFAULT_WINDOWS_HOURS;
const checkEveryMs = Number(env.REMINDER_CHECK_SECONDS ?? 60) * 1000;

const { catalog, store } = openHuddleData();
const agent = new HuddleAgent({
  catalog,
  store,
  places: googlePlacesFinder(config.googleApiKey, catalog, {
    cacheTtlMs: config.cacheTtlMs,
    gemini: config.geminiApiKey ? { apiKey: config.geminiApiKey, model: config.geminiModel! } : undefined,
  }),
  log: (msg) => console.error(`[huddle] ${msg}`),
});

const app = await Spectrum({
  // Spectrum reads SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET from the environment.
  providers: [
    ...(useIMessage ? [imessage.config()] : []),
    ...(useTerminal
      ? [
          terminal.config({
            commands: [
              { name: '/games', description: 'Games you signed up for' },
              { name: '/remind', description: 'Send the reminder for your next game now' },
              { name: '/help', description: 'What Huddle can do' },
            ],
          }),
        ]
      : []),
  ],
});

// Last conversation we saw per fan, so reminders land in the same thread.
const spaces = new Map<string, Space>();

async function deliver(space: Space, replies: Reply[]): Promise<void> {
  for (const r of replies) {
    if (r.kind === 'text') await space.send(r.text);
    else await space.send(attachment(r.data, { name: r.name, mimeType: r.mimeType }));
  }
}

function canReach(handle: string): boolean {
  return useIMessage || handle === terminalHandle;
}

async function spaceFor(handle: string): Promise<Space> {
  const known = spaces.get(handle);
  if (known) return known;
  if (useTerminal && handle === terminalHandle) return terminal(app).space.get('chat-1');
  const im = imessage(app);
  return im.space.create(await im.user(handle));
}

let checking = false;
async function sendDueReminders(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    for (const { fan, game, keys } of dueReminders(store, catalog, new Date(), windowsHours)) {
      if (!canReach(fan.handle)) continue;
      try {
        await deliver(await spaceFor(fan.handle), await agent.buildReminder(fan, game));
        store.markRemindersSent(keys);
      } catch (err) {
        console.error(`[huddle] reminder to ${fan.handle} for ${game.id} failed:`, err);
      }
    }
  } finally {
    checking = false;
  }
}

const timer = setInterval(() => void sendDueReminders(), checkEveryMs);
void sendDueReminders();

async function shutdown(): Promise<void> {
  clearInterval(timer);
  await app.stop();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

console.log(
  `[huddle] agent running on ${[useIMessage && 'iMessage', useTerminal && 'terminal'].filter(Boolean).join(' + ')}`,
);

for await (const [space, message] of app.messages) {
  const handle = message.platform === 'terminal' ? terminalHandle : message.sender?.id;
  if (!handle) continue;
  spaces.set(handle, space);
  try {
    await space.responding(async () => {
      const text = message.content.type === 'text' ? message.content.text : '';
      await deliver(space, await agent.handleMessage(handle, text));
    });
  } catch (err) {
    console.error(`[huddle] failed to answer ${handle}:`, err);
  }
}
