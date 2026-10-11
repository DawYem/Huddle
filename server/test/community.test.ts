import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { HuddleAgent, type Reply } from '../src/agent/brain.js';
import type { PlacesFinder } from '../src/agent/places.js';
import { loadCatalog } from '../src/huddle/catalog.js';
import { newEvent } from '../src/huddle/community.js';
import { signLocationRequest } from '../src/huddle/locationLink.js';
import { RedisBackend, Store } from '../src/huddle/store.js';
import { eventsRouter } from '../src/routes/events.js';

const DATA = join(import.meta.dirname, '..', 'data');
const catalog = loadCatalog(join(DATA, 'games.json'), join(DATA, 'perks.json'));
const FAN = '+14045550123';
const HOST = '+14045550188';
const SECRET = 'test-secret';
const PENN = { lat: 40.7506, lng: -73.9935 };
const texts = (r: Reply[]) => r.filter((x) => x.kind === 'text').map((x) => (x as { text: string }).text).join('\n');
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function setup(opts: { bars?: number; queueWaitMs?: number } = {}) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'));
  const places: PlacesFinder = {
    foodNear: async () => [],
    watchSpotsNear: async () => [],
    barsNear: async (_lat, _lng, sport) => ({ text: `BARS for ${sport.label}`, count: opts.bars ?? 0 }),
    geocode: async () => ({ ...PENN, label: 'Penn Station, New York' }),
  };
  const agent = new HuddleAgent({
    catalog,
    store,
    places,
    hostLink: (fan, sport) => `https://huddling.vercel.app/host?t=${sport.id}-${fan.handle}`,
    queueWaitMs: opts.queueWaitMs ?? 0,
  });
  return { store, agent };
}

// "soccer bar near Penn Station" with no bars -> the community question.
async function noBars(agent: HuddleAgent) {
  return texts(await agent.handleMessage(FAN, 'soccer bar near Penn Station'));
}

function event(fields: Partial<Parameters<typeof newEvent>[0]> = {}) {
  return newEvent({
    sport: 'soccer',
    venueName: 'Fan Club Hall',
    address: '1 Penn Plaza, New York',
    lat: 40.752,
    lng: -73.993,
    startsAt: inHours(3),
    hostName: 'Alex',
    hostHandle: HOST,
    ...fields,
  });
}

test('no bars -> join? YES -> nearby event listed -> pick -> joined', async () => {
  const { store, agent } = setup();
  await store.addEvent(event());
  await store.addEvent(event({ sport: 'basketball', venueName: 'Wrong Sport' }));
  await store.addEvent(event({ venueName: 'Too Far', lat: 41.2, lng: -73.9 }));
  await store.addEvent(event({ venueName: 'Already Over', startsAt: inHours(-5) }));

  assert.match(await noBars(agent), /couldn't find soccer bars near Penn Station.*Want to join a community watch event near you\? Reply YES or NO\./s);
  const list = texts(await agent.handleMessage(FAN, 'yes'));
  assert.match(list, /Soccer watch parties near you:\n1\. Soccer at Fan Club Hall \(0\.\d mi\), .* hosted by Alex, 1 going/);
  assert.doesNotMatch(list, /Wrong Sport|Too Far|Already Over/);

  const joined = texts(await agent.handleMessage(FAN, '1'));
  assert.match(joined, /You're in! Soccer watch party at Fan Club Hall/);
  assert.match(joined, /2 going/);
  assert.deepEqual((await store.events())[0].attendees, [HOST, FAN]);
});

test('join? YES with nothing nearby waits a few seconds, then queues the fan', async () => {
  const { store, agent } = setup({ queueWaitMs: 30 });
  await noBars(agent);
  const started = Date.now();
  assert.match(texts(await agent.handleMessage(FAN, 'YES')), /You're in the queue/);
  assert.ok(Date.now() - started >= 25, 'looked again after waiting');
  assert.deepEqual(
    (await store.waitlist()).map((w) => [w.handle, w.sport, w.lat, w.lng]),
    [[FAN, 'soccer', PENN.lat, PENN.lng]],
  );
});

test('an event listed during the wait is offered instead of queueing', async () => {
  const { store, agent } = setup({ queueWaitMs: 60 });
  await noBars(agent);
  setTimeout(() => void store.addEvent(event({ venueName: 'Just Listed' })), 10);
  assert.match(texts(await agent.handleMessage(FAN, 'yes')), /Found one! .*Just Listed/s);
  assert.deepEqual(await store.waitlist(), []);
});

test('join? NO -> hosting? YES sends the list-your-venue link', async () => {
  const { agent } = setup();
  await noBars(agent);
  assert.match(texts(await agent.handleMessage(FAN, 'no')), /Are you hosting a soccer watch event\? Reply YES or NO\./);
  const link = texts(await agent.handleMessage(FAN, 'yes'));
  assert.match(link, /List your venue here .*\nhttps:\/\/huddling\.vercel\.app\/host\?t=soccer-\+14045550123/s);
});

test('join? NO -> hosting? NO ends politely; anything else re-asks', async () => {
  const { agent } = setup();
  await noBars(agent);
  assert.match(texts(await agent.handleMessage(FAN, 'maybe')), /Reply YES or NO/);
  await agent.handleMessage(FAN, 'no');
  assert.match(texts(await agent.handleMessage(FAN, 'nah')), /That's every option I've got for now/);
  // Flow is over: a later "yes" isn't treated as an answer.
  assert.doesNotMatch(texts(await agent.handleMessage(FAN, 'yes')), /watch event/);
});

test('bars found -> no community question', async () => {
  const { agent } = setup({ bars: 3 });
  const r = await noBars(agent);
  assert.match(r, /BARS for Soccer/);
  assert.doesNotMatch(r, /community/);
});

test('host lists a venue -> waiting fans nearby are texted, then join with YES', async () => {
  const { store, agent } = setup();
  await noBars(agent);
  await agent.handleMessage(FAN, 'yes'); // queued
  await store.addToWaitlist({ handle: '+15550000001', sport: 'basketball', lat: PENN.lat, lng: PENN.lng, since: '' });

  const sent: { handle: string; texts: string[] }[] = [];
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify({ places: [{ location: { latitude: 40.752, longitude: -73.993 }, formattedAddress: '1 Penn Plaza, New York, NY' }] }),
    )) as unknown as typeof fetch;
  const app = express()
    .use(express.json())
    .use(
      '/api/events',
      eventsRouter({ store, apiKey: 'k', linkSecret: SECRET, fetchFn: fakeFetch, sendTexts: async (h, t) => void sent.push({ handle: h, texts: t }) }),
    );

  const t = signLocationRequest({ handle: HOST, sport: 'soccer', is21Plus: true, ...PENN }, SECRET);
  assert.deepEqual((await request(app).get(`/api/events/host?t=${t}`)).body, { sport: { id: 'soccer', label: 'Soccer' } });

  const bad = await request(app).post('/api/events').send({ t, hostName: '', venueName: 'X', address: 'Y', sport: 'soccer', startsAt: 'nope' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.fields).sort(), ['hostName', 'startsAt']);

  const res = await request(app)
    .post('/api/events')
    .send({ t, hostName: 'Alex', venueName: 'Fan Club Hall', address: '1 Penn Plaza', sport: 'soccer', startsAt: inHours(4) });
  assert.equal(res.status, 201);
  assert.equal(res.body.notified, 1, 'only the soccer fan nearby');
  assert.equal(res.body.event.hostHandle, HOST);
  assert.equal(sent[0].handle, FAN);
  assert.match(sent[0].texts[0], /soccer watch party was just listed near you: Fan Club Hall.*Reply YES/);
  assert.deepEqual((await store.waitlist()).map((w) => w.handle), ['+15550000001']);

  // The fan's YES reaches the agent, which reads the saved prompt.
  const fresh = new HuddleAgent({ catalog, store, places: {} as PlacesFinder, queueWaitMs: 0 });
  assert.match(texts(await fresh.handleMessage(FAN, 'Yes')), /1\. Soccer at Fan Club Hall/);
  assert.match(texts(await fresh.handleMessage(FAN, '1')), /You're in!/);
});

test('RedisBackend reads and writes the whole store as one JSON value', async () => {
  const kv = new Map<string, string>();
  const calls: string[][] = [];
  const fakeRedis = (async (_url: string, init: RequestInit) => {
    const args = JSON.parse(init.body as string) as string[];
    calls.push(args);
    if (args[0] === 'GET') return new Response(JSON.stringify({ result: kv.get(args[1]) ?? null }));
    kv.set(args[1], args[2]);
    return new Response(JSON.stringify({ result: 'OK' }));
  }) as typeof fetch;
  const store = new Store(new RedisBackend('https://redis.example', 'tok', { fans: [], signups: [] }, 'huddle:store', fakeRedis));
  await store.upsertFan(FAN, { name: 'Sam' });
  await store.addEvent(event());
  assert.equal((await store.getFan(FAN))?.name, 'Sam');
  assert.equal((await store.events()).length, 1);
  assert.ok(calls.some((c) => c[0] === 'SET' && c[1] === 'huddle:store'));
});
