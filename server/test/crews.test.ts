import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { HuddleAgent, type Reply } from '../src/agent/brain.js';
import type { PlacesFinder } from '../src/agent/places.js';
import { createApp } from '../src/createApp.js';
import { loadCatalog } from '../src/huddle/catalog.js';
import { displayName, MAX_CREW, publicCrew, signCrew, verifyCrew } from '../src/huddle/crews.js';
import { Store } from '../src/huddle/store.js';
import type { BarPick } from '../src/huddle/types.js';

const DATA = join(import.meta.dirname, '..', 'data');
const catalog = loadCatalog(join(DATA, 'games.json'), join(DATA, 'perks.json'));
const SECRET = 'test-secret';
const texts = (r: Reply[]) => r.filter((x) => x.kind === 'text').map((x) => (x as { text: string }).text).join('\n');

const BARS: BarPick[] = [
  { id: 'place-kickoff', name: 'Kick Off Pub', address: '1 Main St, New York', lat: 40.751, lng: -73.993 },
  { id: 'place-goal', name: 'Goal Cafe', address: '2 Main St, New York', lat: 40.752, lng: -73.994 },
];

function setup() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'));
  const places: PlacesFinder = {
    foodNear: async () => [],
    watchSpotsNear: async () => [],
    barsNear: async (_lat, _lng, sport) => ({
      text: `1. Kick Off Pub\n2. Goal Cafe\nReply with a number to pick your spot (${sport.label})`,
      count: BARS.length,
      bars: BARS,
    }),
    geocode: async () => ({ lat: 40.7506, lng: -73.9935, label: 'Penn Station, New York, NY 10119' }),
  };
  const agent = new HuddleAgent({
    catalog,
    store,
    places,
    crewLink: (crew, fan) => `https://huddling.vercel.app/crew/${crew.id}?name=${(fan.name ?? 'You').split(' ')[0]}`,
  });
  return { store, agent };
}

async function pickBar(agent: HuddleAgent, store: Store, handle: string, name: string, choice: string) {
  await store.upsertFan(handle, { name, textedFirst: true });
  await agent.handleMessage(handle, 'soccer bar near Penn Station');
  return texts(await agent.handleMessage(handle, choice));
}

test('picking a bar matches the fan into a crew and sends the crew page link', async () => {
  const { store, agent } = setup();
  const first = await pickBar(agent, store, '+14045550001', 'Sam Lee', '1');
  assert.match(first, /You're matched! You're the first fan watching soccer at Kick Off Pub\./);
  assert.match(first, /See your crew: https:\/\/huddling\.vercel\.app\/crew\/[\w-]+\?name=Sam/);

  const second = await pickBar(agent, store, '+14045550002', 'Aisha Khan', '1');
  assert.match(second, /You and 1 other fan are watching soccer at Kick Off Pub\./);
  const crewId = /crew\/([\w-]+)\?/.exec(first)![1];
  assert.equal(/crew\/([\w-]+)\?/.exec(second)![1], crewId, 'same bar + sport = same crew');
  assert.deepEqual((await store.crew(crewId))!.members.map((m) => m.name), ['Sam L.', 'Aisha K.']);

  // A different bar starts a different crew.
  const other = await pickBar(agent, store, '+14045550003', 'Dev Ott', '2');
  assert.notEqual(/crew\/([\w-]+)\?/.exec(other)![1], crewId);
});

test('crews cap at 6 fans, then a new crew opens at the same bar', async () => {
  const { store, agent } = setup();
  const ids = new Set<string>();
  for (let i = 0; i < MAX_CREW + 1; i++) {
    const r = await pickBar(agent, store, `+1404555010${i}`, `Fan${i} Test`, '1');
    ids.add(/crew\/([\w-]+)\?/.exec(r)![1]);
  }
  assert.equal(ids.size, 2);
  // Picking again doesn't duplicate you.
  const again = await pickBar(agent, store, '+14045550100', 'Fan0 Test', '1');
  assert.match(again, /You and 5 other fans/);
});

test('a non-number reply after the bar list is handled normally', async () => {
  const { store, agent } = setup();
  await store.upsertFan('+14045550009', { textedFirst: true });
  await agent.handleMessage('+14045550009', 'soccer bar near Penn Station');
  assert.match(texts(await agent.handleMessage('+14045550009', 'my games')), /not signed up|Your games/);
  assert.equal((await store.events()).length, 0);
});

test('displayName never exposes more than a first name and initial', () => {
  assert.equal(displayName({ name: 'Sam Lee' }), 'Sam L.');
  assert.equal(displayName({ name: 'Cher' }), 'Cher');
  assert.equal(displayName({}), 'Huddle fan');
});

test('GET /api/crews/:id serves live crews, falls back to the signed link, never phone numbers', async () => {
  const { store, agent } = setup();
  const reply = await pickBar(agent, store, '+14045550001', 'Sam Lee', '1');
  const crewId = /crew\/([\w-]+)\?/.exec(reply)![1];
  const app = createApp(
    { googleApiKey: 'k', port: 0, rateLimitPerMinute: 1000, cacheTtlMs: 1000, linkSecret: SECRET },
    fetch,
    { catalog, store },
  );

  const live = await request(app).get(`/api/crews/${crewId}`);
  assert.equal(live.status, 200);
  assert.equal(live.body.source, 'live');
  assert.deepEqual(live.body.crew.members, ['Sam L.']);
  assert.equal(live.body.crew.venueName, 'Kick Off Pub');
  assert.doesNotMatch(JSON.stringify(live.body), /\+1404/);

  // A server that can't see the crew (separate storage) uses the signed snapshot.
  const emptyApp = createApp(
    { googleApiKey: 'k', port: 0, rateLimitPerMinute: 1000, cacheTtlMs: 1000, linkSecret: SECRET },
    fetch,
    { catalog, store: new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json')) },
  );
  const token = signCrew(publicCrew((await store.crew(crewId))!), SECRET);
  const fromLink = await request(emptyApp).get(`/api/crews/${crewId}?c=${token}`);
  assert.equal(fromLink.status, 200);
  assert.equal(fromLink.body.source, 'link');
  assert.equal((await request(emptyApp).get(`/api/crews/${crewId}`)).status, 404);
  assert.equal((await request(emptyApp).get(`/api/crews/other-id?c=${token}`)).status, 404, 'snapshot only for its own crew');

  assert.equal(verifyCrew(token, 'wrong-secret'), undefined);
  assert.equal(verifyCrew(token, SECRET, Date.now() + 8 * 24 * 3_600_000), undefined, 'links expire after a week');
});
