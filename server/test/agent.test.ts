import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { buildIcs, googleCalendarUrl } from '../src/agent/calendar.js';
import { HuddleAgent, type Reply } from '../src/agent/brain.js';
import { rankFood, type PlacesFinder } from '../src/agent/places.js';
import { dueReminders, reminderKey } from '../src/agent/reminders.js';
import { createApp } from '../src/createApp.js';
import type { WatchSpot } from '../src/google/places.js';
import { findGame, findTeams, loadCatalog } from '../src/huddle/catalog.js';
import { Store } from '../src/huddle/store.js';
import type { Fan } from '../src/huddle/types.js';

const DATA = join(import.meta.dirname, '..', 'data');
const catalog = loadCatalog(join(DATA, 'games.json'), join(DATA, 'perks.json'));
const FAN = '+15555550100';
// Saturday evening, the day before the Knicks game (Sun 7:30 PM EDT).
const NOW = new Date('2026-10-10T22:00:00Z');

function freshStore(): Store {
  return new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'), join(DATA, 'store.seed.json'));
}

function spot(id: string, name: string, distanceMeters: number, extra: Partial<WatchSpot> = {}): WatchSpot {
  return { id, name, lat: 40.75, lng: -73.98, distanceMeters, ...extra };
}

const fakePlaces: PlacesFinder = {
  async foodNear(venue, fan) {
    return rankFood(
      [
        spot(venue.placeId!, venue.name, 0, { primaryType: 'sports_bar' }),
        spot('near-diner', 'Near Diner', 50, { primaryType: 'diner', openNow: true }),
        spot('ChIJ5y1KDFhZwokR5GHmHxnyrms', 'Roma Pizza & restaurant', 300, { primaryType: 'pizza_restaurant' }),
      ],
      venue,
      fan,
      catalog,
    );
  },
  async watchSpotsNear() {
    return [
      {
        ...spot('sb1', 'Corner Sports Bar', 400),
        reason: '0.2 mi away, open now',
        directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=40.75%2C-73.98',
      },
    ];
  },
};

function agentWith(store: Store, now = NOW) {
  return new HuddleAgent({ catalog, store, places: fakePlaces, now: () => now });
}

const texts = (replies: Reply[]) => replies.filter((r) => r.kind === 'text').map((r) => r.text).join('\n---\n');

test('team matching uses aliases and whole words', () => {
  assert.deepEqual(findTeams(catalog, "can't find the Knicks game"), ['New York Knicks']);
  assert.deepEqual(findTeams(catalog, 'man utd vs liverpool?'), ['Manchester United', 'Liverpool']);
  assert.deepEqual(findTeams(catalog, 'disunited'), []);
});

test('find a team, join a game by number, then add it to the calendar', async () => {
  const store = freshStore();
  const agent = agentWith(store);

  const list = texts(await agent.handleMessage(FAN, 'find Knicks'));
  assert.match(list, /1\. New York Knicks vs Boston Celtics .* ✅ joined/);
  assert.match(list, /2\. Atlanta Hawks vs New York Knicks/);

  const joined = texts(await agent.handleMessage(FAN, '2'));
  assert.match(joined, /You're in for Atlanta Hawks vs New York Knicks/);
  assert.ok((await store.signupsFor(FAN)).some((s) => s.gameId === 'nba-hawks-knicks-1018'));

  const cal = await agent.handleMessage(FAN, 'yes');
  const file = cal.find((r) => r.kind === 'file');
  assert.ok(file && file.kind === 'file');
  assert.equal(file.mimeType, 'text/calendar');
  assert.match(file.data.toString(), /UID:nba-hawks-knicks-1018@huddle/);
  assert.match(texts(cal), /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
});

test("a team with no crews gets other games and nearby spots instead", async () => {
  const agent = agentWith(freshStore());
  const replies = texts(await agent.handleMessage(FAN, "I can't find the Lakers game"));
  assert.match(replies, /couldn't find that game/);
  assert.match(replies, /Other crews coming up:\n1\. /);
  // Already-joined games aren't offered again.
  assert.doesNotMatch(replies, /Knicks vs Boston Celtics/);
  assert.match(replies, /Corner Sports Bar/);
  assert.match(replies, /Call ahead/);
});

test('reminder for a venue without food suggests food nearby, perks first, never the venue', async () => {
  const store = freshStore();
  const agent = agentWith(store, new Date('2026-10-16T12:00:00Z'));
  const fan = await store.getFan(FAN)!;
  const replies = await agent.buildReminder(fan, findGame(catalog, 'epl-arsenal-chelsea-1017')!);
  const body = texts(replies);

  assert.match(body, /⏰ Arsenal vs Chelsea is in 24 hours/);
  assert.match(body, /Sat, Oct 17, 7:30 AM EDT/);
  assert.match(body, /The Keg Room doesn't serve food/);
  const roma = body.indexOf('Roma Pizza');
  const diner = body.indexOf('Near Diner');
  assert.ok(roma > -1 && diner > roma, 'perk venue is listed first');
  assert.match(body, /🎁 Huddle perk: Free garlic knots/);
  assert.doesNotMatch(body, /• The Keg Room/);
  assert.match(body, /Reply YES or NO/);

  assert.match(texts(await agent.handleMessage(FAN, 'no')), /No problem/);
});

test('reminder for a venue with food skips the food list', async () => {
  const store = freshStore();
  const body = texts(await agentWith(store).buildReminder(await store.getFan(FAN)!, findGame(catalog, 'nba-knicks-celtics-1011')!));
  assert.doesNotMatch(body, /serve food/);
});

test('rankFood keeps under-21 fans away from bars', () => {
  const venue = findGame(catalog, 'epl-arsenal-chelsea-1017')!.venue;
  const minor: Fan = { handle: FAN, is21Plus: false, textedFirst: true, optedOut: false };
  const picked = rankFood(
    [spot('bar1', 'Some Bar', 10, { primaryType: 'bar' }), spot('cafe1', 'Cafe', 20, { primaryType: 'cafe' })],
    venue,
    minor,
    catalog,
  );
  assert.deepEqual(picked.map((s) => s.id), ['cafe1']);
});

test('reminders wait for opt-in, respect stop, and never double-send', async () => {
  const store = freshStore();
  const knicks = 'nba-knicks-celtics-1011'; // Sun Oct 11, 23:30Z
  const at = (iso: string) => dueReminders(store, catalog, new Date(iso));

  // Signed up on the website but never texted Huddle: no reminders.
  assert.equal((await at('2026-10-11T00:00:00Z')).length, 0);

  await agentWith(store).handleMessage(FAN, 'hi');
  // 23.5 hours out: the 24h reminder is due.
  let due = (await at('2026-10-11T00:00:00Z'));
  assert.deepEqual(due.map((d) => d.keys), [[reminderKey(knicks, FAN, 24)]]);
  await store.markRemindersSent(due[0].keys);
  assert.equal((await at('2026-10-11T00:05:00Z')).length, 0);

  // 1.5 hours out: the 2h reminder is due once.
  due = (await at('2026-10-11T22:00:00Z'));
  assert.equal(due.length, 1);
  await store.markRemindersSent(due[0].keys);
  assert.equal((await at('2026-10-11T22:30:00Z')).length, 0);

  // After kickoff: nothing.
  assert.equal((await at('2026-10-11T23:31:00Z')).length, 0);

  // "stop" silences everything until "start".
  const agent = agentWith(store);
  await store.addSignup('epl-united-liverpool-1018', FAN);
  await agent.handleMessage(FAN, 'stop');
  assert.equal((await at('2026-10-18T14:30:00Z')).length, 0);
  await agent.handleMessage(FAN, 'start');
  // A late sign-up 1 hour out gets one text that covers both windows.
  assert.deepEqual((await at('2026-10-18T14:30:00Z'))[0].keys, [
    reminderKey('epl-united-liverpool-1018', FAN, 2),
    reminderKey('epl-united-liverpool-1018', FAN, 24),
  ]);
});

test('my games lists sign-ups and a number sends that invite', async () => {
  const agent = agentWith(freshStore());
  const list = texts(await agent.handleMessage(FAN, 'my games'));
  assert.match(list, /1\. New York Knicks vs Boston Celtics/);
  assert.match(list, /2\. Arsenal vs Chelsea/);
  const cal = await agent.handleMessage(FAN, '2');
  const file = cal.find((r) => r.kind === 'file');
  assert.ok(file && file.kind === 'file' && /epl-arsenal-chelsea-1017/.test(file.name));
});

test('.ics is valid: CRLF lines, UTC times, folded at 75 octets', () => {
  const game = findGame(catalog, 'nba-knicks-celtics-1011')!;
  const ics = buildIcs(game, NOW);
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `too long: ${line}`);
  assert.match(ics, /DTSTART:20261011T233000Z/);
  assert.match(ics, /DTEND:20261012T020000Z/);
  assert.match(ics, /LOCATION:Smithfield Hall NYC\\, 138 W 25th St\\, New York\\, NY 10001/);
  assert.match(googleCalendarUrl(game), /dates=20261011T233000Z%2F20261012T020000Z/);
});

test('GET /api/games filters by team and POST signups validates input', async () => {
  const store = freshStore();
  const app = createApp(
    { googleApiKey: 'k', port: 0, rateLimitPerMinute: 1000, cacheTtlMs: 1000 },
    fetch,
    { catalog, store },
  );

  const knicks = await request(app).get('/api/games?team=knicks');
  assert.equal(knicks.status, 200);
  assert.ok(knicks.body.games.length >= 1);
  for (const g of knicks.body.games) assert.ok([g.home, g.away].includes('New York Knicks'));

  const bad = await request(app).post('/api/games/nfl-giants-eagles-1019/signups').send({ handle: '555-1234' });
  assert.equal(bad.status, 400);
  const missing = await request(app).post('/api/games/nope/signups').send({ handle: '+15551234567' });
  assert.equal(missing.status, 404);

  const ok = await request(app)
    .post('/api/games/nfl-giants-eagles-1019/signups')
    .send({ handle: '+15551234567', name: 'Sam', is21Plus: true, lat: 40.7, lng: -73.9 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.textedHuddle, false);
  const again = await request(app).post('/api/games/nfl-giants-eagles-1019/signups').send({ handle: '+15551234567' });
  assert.equal(again.status, 200);
  // A later form without is21Plus doesn't downgrade a confirmed fan.
  assert.equal((await store.getFan('+15551234567'))?.is21Plus, true);
});

test('YES after several reminders at once adds every offered game', async () => {
  const store = freshStore();
  const agent = agentWith(store);
  const fan = await store.getFan(FAN)!;
  await agent.buildReminder(fan, findGame(catalog, 'nba-knicks-celtics-1011')!);
  const second = texts(await agent.buildReminder(fan, findGame(catalog, 'epl-arsenal-chelsea-1017')!));
  assert.match(second, /Want all 2 of these games on your calendar\?/);
  const files = (await agent.handleMessage(FAN, 'yes')).filter((r) => r.kind === 'file');
  assert.deepEqual(
    files.map((f) => f.kind === 'file' && f.name),
    ['huddle-nba-knicks-celtics-1011.ics', 'huddle-epl-arsenal-chelsea-1017.ics'],
  );
});

test('"Hi Huddle", the text the website pre-fills, gets the welcome', async () => {
  const agent = agentWith(freshStore());
  for (const text of ['Hi Huddle', 'hey huddle!', 'hi']) {
    const replies = texts(await agent.handleMessage('+14045550123', text));
    assert.doesNotMatch(replies, /didn't get that/, text);
    assert.match(replies, /I'm Huddle/, text);
  }
});

test('only real texts from a person get a reply (no read-receipt loop)', async () => {
  const { textToAnswer, ReplyGuard } = await import('../src/agent/inbound.js');
  assert.equal(textToAnswer({ content: { type: 'text', text: ' Hi Huddle ' } }), 'Hi Huddle');
  for (const type of ['read', 'typing', 'reaction', 'attachment', 'rename']) {
    assert.equal(textToAnswer({ content: { type } }), undefined, type);
  }
  assert.equal(textToAnswer({ content: { type: 'text', text: '   ' } }), undefined);
  assert.equal(textToAnswer({ content: { type: 'text', text: 'hi' }, direction: 'outbound' }), undefined);
  assert.equal(textToAnswer({ content: { type: 'text', text: 'hi' }, sender: { kind: 'agent' } }), undefined);

  const guard = new ReplyGuard(3, 60_000);
  const t = 1_000_000;
  assert.deepEqual([1, 2, 3, 4].map((i) => guard.allow('+1', t + i)), [true, true, true, false]);
  assert.equal(guard.allow('+2', t), true, 'other fans unaffected');
  assert.equal(guard.allow('+1', t + 61_000), true, 'allowed again after the window');
});
