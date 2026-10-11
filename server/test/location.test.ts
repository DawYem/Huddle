import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { HuddleAgent, type Reply } from '../src/agent/brain.js';
import { locationFrom, pollChoice } from '../src/agent/inbound.js';
import type { PlacesFinder } from '../src/agent/places.js';
import { createApp } from '../src/createApp.js';
import { loadCatalog } from '../src/huddle/catalog.js';
import { signLocationRequest, verifyLocationRequest } from '../src/huddle/locationLink.js';
import { extractLatLng } from '../src/huddle/mapsLink.js';
import { matchSport } from '../src/huddle/sports.js';
import { Store } from '../src/huddle/store.js';

const DATA = join(import.meta.dirname, '..', 'data');
const catalog = loadCatalog(join(DATA, 'games.json'), join(DATA, 'perks.json'));
const FAN = '+14045550123';
const SECRET = 'test-secret';
const texts = (r: Reply[]) => r.filter((x) => x.kind === 'text').map((x) => (x as { text: string }).text).join('\n');

// What iMessage sends for "Send My Current Location".
const APPLE_PIN_VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:;Current Location;;;',
  'FN:Current Location',
  'item1.URL;type=pref:http://maps.apple.com/?ll=40.750500\\,-73.993400&q=40.750500\\,-73.993400',
  'item1.X-ABLabel:map url',
  'END:VCARD',
].join('\r\n');

test('extractLatLng reads Apple pins, Maps links and plain coordinates', () => {
  assert.deepEqual(extractLatLng('http://maps.apple.com/?ll=40.7505,-73.9934&q=Pin'), { lat: 40.7505, lng: -73.9934 });
  assert.deepEqual(extractLatLng(APPLE_PIN_VCARD.replace(/\\,/g, ',')), { lat: 40.7505, lng: -73.9934 });
  assert.deepEqual(extractLatLng('https://www.google.com/maps/@40.7128,-74.0060,15z'), { lat: 40.7128, lng: -74.006 });
  assert.deepEqual(extractLatLng('https://maps.google.com/?q=40.7128%2C-74.0060'), { lat: 40.7128, lng: -74.006 });
  assert.deepEqual(extractLatLng("I'm at 40.7505, -73.9934"), { lat: 40.7505, lng: -73.9934 });
  assert.equal(extractLatLng('Midtown Manhattan'), undefined);
  assert.equal(extractLatLng('call me at 404.555, 0123'), undefined);
});

test('locationFrom handles contact, rich link and .vcf attachment deliveries', async () => {
  const at = { lat: 40.7505, lng: -73.9934 };
  assert.deepEqual(await locationFrom({ content: { type: 'contact', urls: ['http://maps.apple.com/?ll=40.7505,-73.9934'] } }), at);
  assert.deepEqual(await locationFrom({ content: { type: 'richlink', url: 'http://maps.apple.com/?ll=40.7505,-73.9934' } }), at);
  assert.deepEqual(
    await locationFrom({
      content: { type: 'attachment', name: 'CL.loc.vcf', mimeType: 'text/x-vcard', read: async () => Buffer.from(APPLE_PIN_VCARD) },
    }),
    at,
  );
  assert.equal(await locationFrom({ content: { type: 'attachment', name: 'photo.jpg', mimeType: 'image/jpeg' } }), undefined);
  assert.equal(pollChoice({ content: { type: 'poll_option', title: 'Soccer', selected: true } }), 'Soccer');
  assert.equal(pollChoice({ content: { type: 'poll_option', title: 'Soccer', selected: false } }), undefined);
});

test('matchSport understands names, leagues and numbers', () => {
  assert.equal(matchSport('Soccer')?.id, 'soccer');
  assert.equal(matchSport('premier league')?.id, 'soccer');
  assert.equal(matchSport('nba bar near me')?.id, 'basketball');
  assert.equal(matchSport('2')?.id, 'football');
  assert.equal(matchSport('pizza'), undefined);
});

test('location links are signed and expire', () => {
  const t = signLocationRequest({ handle: FAN, sport: 'soccer', is21Plus: true }, SECRET, 1_000);
  assert.equal(verifyLocationRequest(t, SECRET, 2_000)?.handle, FAN);
  assert.equal(verifyLocationRequest(t, 'other-secret', 2_000), undefined);
  assert.equal(verifyLocationRequest(t, SECRET, 1_000 + 61 * 60_000), undefined, 'expired after an hour');
  const [payload, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ handle: '+15551112222', sport: 'soccer', is21Plus: true, exp: 9e15 })).toString('base64url');
  assert.equal(verifyLocationRequest(`${forged}.${sig}`, SECRET, 2_000), undefined, 'payload swap rejected');
  assert.equal(verifyLocationRequest(`${payload}.`, SECRET, 2_000), undefined);
});

function agent() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'));
  const calls: string[] = [];
  const places: PlacesFinder = {
    foodNear: async () => [],
    watchSpotsNear: async () => [],
    barsNear: async (lat, lng, sport) => {
      calls.push(`bars ${sport.id} ${lat},${lng}`);
      return { text: `BARS for ${sport.label}`, count: 3 };
    },
    geocode: async (text) => (/penn/i.test(text) ? { lat: 40.7506, lng: -73.9935, label: 'Penn Station, New York' } : undefined),
  };
  const a = new HuddleAgent({
    catalog,
    store,
    places,
    locationLink: (fan, sport) => `https://huddling.vercel.app/locate?t=${sport.id}-${fan.handle}`,
  });
  return { a, store, calls };
}

test('bars flow: poll for sport, then link or a typed place, then bars', async () => {
  const { a, store, calls } = agent();
  // Numbered list (native poll votes don't reach the agent in spectrum-ts 12.10.1).
  const first = texts(await a.handleMessage(FAN, 'find a bar near me'));
  assert.match(first, /Which sport are you watching\?\n1\. Basketball\n2\. Football\n3\. Soccer/);

  // Tapping the poll arrives as the option title.
  const ask = texts(await a.handleMessage(FAN, 'Soccer'));
  assert.match(ask, /Soccer it is/);
  assert.match(ask, /Tap to share your location: https:\/\/huddling\.vercel\.app\/locate\?t=soccer-/);

  const bars = texts(await a.handleMessage(FAN, 'Penn Station'));
  assert.match(bars, /Near Penn Station, New York:\nBARS for Soccer/);
  assert.deepEqual(calls, ['bars soccer 40.7506,-73.9935']);
  assert.equal((await store.getFan(FAN))?.lat, 40.7506, 'location saved on the fan');
});

test('bars flow: sport and place in one text, unknown place, and bailing out', async () => {
  const { a, calls } = agent();
  assert.match(texts(await a.handleMessage(FAN, 'nba bar near Penn Station')), /BARS for Basketball/);
  assert.deepEqual(calls, ['bars basketball 40.7506,-73.9935']);

  await a.handleMessage(FAN, 'soccer bars');
  assert.match(texts(await a.handleMessage(FAN, 'Narnia')), /couldn't find "Narnia"/);
  // Other commands still work mid-flow.
  assert.match(texts(await a.handleMessage(FAN, 'my games')), /not signed up|Your games/);
});

test('a shared pin before picking a sport asks for the sport, then answers', async () => {
  const { a, calls } = agent();
  const r = await a.handleLocation(FAN, { lat: 40.75, lng: -73.99 });
  assert.match(texts(r), /Got your location/);
  assert.match(texts(r), /Which sport/);
  assert.match(texts(await a.handleMessage(FAN, '3')), /BARS for Soccer/);
  assert.deepEqual(calls, ['bars soccer 40.75,-73.99']);
});

test('POST /api/locate checks the link, finds bars, and texts them to the fan', async () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'));
  const placesBody: unknown[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    placesBody.push(JSON.parse(init.body as string));
    return new Response(
      JSON.stringify({
        places: [
          { id: 'b1', displayName: { text: 'Kick Off Pub' }, location: { latitude: 40.751, longitude: -73.993 }, primaryType: 'pub', currentOpeningHours: { openNow: true } },
          { id: 'c1', displayName: { text: 'Goal Cafe' }, location: { latitude: 40.752, longitude: -73.994 }, primaryType: 'cafe' },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const sent: { handle: string; texts: string[] }[] = [];
  const app = createApp(
    { googleApiKey: 'k', port: 0, rateLimitPerMinute: 1000, cacheTtlMs: 1000, linkSecret: SECRET },
    fakeFetch,
    { catalog, store },
  );
  // createApp only wires a real Spectrum sender; swap in a fake for the test.
  const { locateRouter } = await import('../src/routes/locate.js');
  const express = (await import('express')).default;
  const testApp = express().use(express.json()).use('/api/locate', locateRouter({ apiKey: 'k', linkSecret: SECRET, catalog, fetchFn: fakeFetch, sendTexts: async (handle, t) => void sent.push({ handle, texts: t }) }));

  const t = signLocationRequest({ handle: FAN, sport: 'soccer', is21Plus: false }, SECRET);
  assert.deepEqual((await request(app).get(`/api/locate?t=${t}`)).body, { sport: { id: 'soccer', label: 'Soccer' } });
  assert.equal((await request(app).get('/api/locate?t=nope')).status, 400);
  assert.equal((await request(testApp).post('/api/locate').send({ t, lat: 'x', lng: 1 })).status, 400);

  const res = await request(testApp).post('/api/locate').send({ t, lat: 40.7505, lng: -73.9934 });
  assert.equal(res.status, 200);
  assert.equal(res.body.texted, true);
  // Under 21 (from the signed link): the pub is filtered out, the cafe stays.
  assert.deepEqual(res.body.bars.map((b: { name: string }) => b.name), ['Goal Cafe']);
  assert.equal((placesBody.at(-1) as { textQuery: string }).textQuery, 'soccer bar');
  assert.equal(sent[0].handle, FAN);
  assert.match(sent[0].texts[0], /Soccer spots near you/);
  assert.match(sent[0].texts[0], /Goal Cafe/);
  assert.match(sent[0].texts[0], /Huddle crews for soccer/);
});

test('typed places: stock replies are not looked up, and far-fetched matches are rejected', async () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'));
  const looked: string[] = [];
  const places: PlacesFinder = {
    foodNear: async () => [],
    watchSpotsNear: async () => [],
    barsNear: async (_lat, _lng, sport) => ({ text: `BARS for ${sport.label}`, count: 3 }),
    geocode: async (text) => {
      looked.push(text);
      // Places' "best guess" for anything: a random place in New Jersey.
      if (/okee/i.test(text) || /^ok/i.test(text)) return { lat: 40.9, lng: -74.1, label: 'Okeefe Ave, Paterson, NJ 07501' };
      if (/penn/i.test(text)) return { lat: 40.7506, lng: -73.9935, label: 'Penn Station, New York, NY 10119' };
      return { lat: 40.2, lng: -74.5, label: 'Route 9, Freehold, NJ 07728' };
    },
  };
  const a = new HuddleAgent({ catalog, store, places });
  await a.handleMessage(FAN, 'soccer bars');

  for (const reply of ['ok', 'yes', '3', 'thanks!', 'k']) {
    const r = texts(await a.handleMessage(FAN, reply));
    if (reply === 'yes' || reply === 'ok' || reply === 'k') continue; // YES/NO end or re-ask the flow
    assert.match(r, /Text a neighborhood and city/, reply);
  }
  assert.deepEqual(looked, [], 'nothing looked up');

  await a.handleMessage(FAN, 'soccer bars');
  assert.match(texts(await a.handleMessage(FAN, 'blorpville')), /couldn't find "blorpville"/);
  assert.match(texts(await a.handleMessage(FAN, 'Penn Station')), /Near Penn Station, New York, NY 10119:\nBARS for Soccer/);
});
