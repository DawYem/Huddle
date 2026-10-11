import { attachment, poll, Spectrum, type Space } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { terminal } from 'spectrum-ts/providers/terminal';
import { loadConfig } from '../config.js';
import { openHuddleData } from '../huddle/data.js';
import { HuddleAgent, type Reply } from './brain.js';
import { signLocationRequest } from '../huddle/locationLink.js';
import { locationFrom, pollChoice, ReplyGuard, textToAnswer, type InboundLike } from './inbound.js';
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
  // Signed Safari link for the location prompt; needs the link secret on both
  // the agent and the deployed API (both default to SPECTRUM_PROJECT_SECRET).
  locationLink: config.linkSecret
    ? (fan, sport) =>
        `${config.siteUrl}/locate?t=${signLocationRequest({ handle: fan.handle, sport: sport.id, is21Plus: fan.is21Plus }, config.linkSecret!)}`
    : undefined,
  hostLink: config.linkSecret
    ? (fan, sport, at) =>
        `${config.siteUrl}/host?t=${signLocationRequest({ handle: fan.handle, sport: sport.id, is21Plus: fan.is21Plus, lat: at.lat, lng: at.lng }, config.linkSecret!)}`
    : undefined,
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
    else if (r.kind === 'file') await space.send(attachment(r.data, { name: r.name, mimeType: r.mimeType }));
    else {
      // Native iMessage poll; numbered list where polls aren't supported.
      try {
        await space.send(poll(r.title, ...r.options));
      } catch {
        const list = r.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
        await space.send(`${r.title}\n${list}\nReply with a number.`);
      }
    }
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
    for (const { fan, game, keys } of await dueReminders(store, catalog, new Date(), windowsHours)) {
      if (!canReach(fan.handle)) continue;
      try {
        await deliver(await spaceFor(fan.handle), await agent.buildReminder(fan, game));
        await store.markRemindersSent(keys);
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

const guard = new ReplyGuard();

for await (const [space, message] of app.messages) {
  const handle = message.platform === 'terminal' ? terminalHandle : message.sender?.id;
  // One line per inbound event (number masked), so "is anything arriving?" is answerable.
  if (message.content.type !== 'typing') {
    console.log(`[huddle] <- ${message.content.type} from ${handle ? handle.replace(/.(?=.{4})/g, '•') : 'unknown'}`);
  }
  if (!handle) continue;
  // Read receipts, typing, reactions etc. also arrive here. Only texts, poll
  // taps and shared locations get a reply.
  const text = textToAnswer(message as InboundLike) ?? pollChoice(message as never);
  let at: Awaited<ReturnType<typeof locationFrom>>;
  if (text === undefined) {
    try {
      at = await locationFrom(message as never);
    } catch (err) {
      console.error(`[huddle] couldn't read ${message.content.type} from ${handle}:`, err);
    }
    if (!at) {
      if (!['read', 'typing', 'reaction'].includes(message.content.type)) {
        console.error(`[huddle] ignored ${message.content.type} from ${handle}`);
      }
      continue;
    }
  }
  spaces.set(handle, space);
  if (!guard.allow(handle)) {
    console.error(`[huddle] reply limit hit for ${handle}; not answering`);
    continue;
  }
  try {
    await space.responding(async () => {
      const replies = at ? await agent.handleLocation(handle, at) : await agent.handleMessage(handle, text!);
      await deliver(space, replies);
    });
  } catch (err) {
    console.error(`[huddle] failed to answer ${handle}:`, err);
  }
}
