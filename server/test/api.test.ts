import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/createApp.js';
import type { Config } from '../src/config.js';
import { TtlCache } from '../src/cache.js';

const config: Config = { googleApiKey: 'test-key', port: 0, rateLimitPerMinute: 1000, cacheTtlMs: 60_000 };

function mockFetch(responder: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = responder(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const place = (id: string, lat: number, lng: number) => ({
  id,
  displayName: { text: `Place ${id}` },
  location: { latitude: lat, longitude: lng },
  primaryType: 'bar',
  currentOpeningHours: { openNow: true },
});

test('GET /api/spots does a nearby search and sorts by distance', async () => {
  const { fn, calls } = mockFetch(() => ({
    body: { places: [place('far', 40.72, -74.0), place('near', 40.7129, -74.006)] },
  }));
  const res = await request(createApp(config, fn)).get('/api/spots?lat=40.7128&lng=-74.006');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.spots.map((s: { id: string }) => s.id), ['near', 'far']);
  assert.equal(res.body.spots[0].openNow, true);
  assert.ok(res.body.spots[0].distanceMeters < 50);

  assert.match(calls[0].url, /places:searchNearby$/);
  const sent = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(sent.includedTypes, ['bar', 'restaurant', 'cafe']);
  assert.equal(sent.locationRestriction.circle.radius, 2000);
  assert.equal((calls[0].init.headers as Record<string, string>)['X-Goog-Api-Key'], 'test-key');
});

test('GET /api/spots with q uses text search', async () => {
  const { fn, calls } = mockFetch(() => ({ body: { places: [] } }));
  const res = await request(createApp(config, fn)).get('/api/spots?lat=1&lng=2&q=sports%20bar');
  assert.equal(res.status, 200);
  assert.match(calls[0].url, /places:searchText$/);
  assert.equal(JSON.parse(String(calls[0].init.body)).textQuery, 'sports bar');
});

test('GET /api/spots caches nearby repeat searches', async () => {
  const { fn, calls } = mockFetch(() => ({ body: { places: [] } }));
  const app = createApp(config, fn);
  await request(app).get('/api/spots?lat=40.71281&lng=-74.0061');
  await request(app).get('/api/spots?lat=40.71284&lng=-74.0062');
  assert.equal(calls.length, 1);
});

test('GET /api/spots rejects bad input without calling Google', async () => {
  const { fn, calls } = mockFetch(() => ({ body: {} }));
  const app = createApp(config, fn);
  for (const qs of ['lng=1', 'lat=91&lng=0', 'lat=0&lng=0&radius=60000', 'lat=0&lng=0&types=casino']) {
    const res = await request(app).get(`/api/spots?${qs}`);
    assert.equal(res.status, 400, qs);
  }
  assert.equal(calls.length, 0);
});

test('Places errors surface as 502', async () => {
  const { fn } = mockFetch(() => ({ status: 403, body: { error: { message: 'API key not valid' } } }));
  const res = await request(createApp(config, fn)).get('/api/spots?lat=0&lng=0');
  assert.equal(res.status, 502);
  assert.equal(res.body.detail, 'API key not valid');
});

test('POST /api/location geolocates from wifi signals', async () => {
  const { fn, calls } = mockFetch(() => ({ body: { location: { lat: 51.5, lng: -0.12 }, accuracy: 30 } }));
  const res = await request(createApp(config, fn))
    .post('/api/location')
    .send({ wifiAccessPoints: [{ macAddress: '00:11:22:33:44:55' }, { macAddress: '66:77:88:99:aa:bb' }] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { lat: 51.5, lng: -0.12, accuracyMeters: 30 });
  assert.equal(JSON.parse(String(calls[0].init.body)).considerIp, false);
});

test('POST /api/location requires signals and maps "no fix" to 404', async () => {
  const { fn } = mockFetch(() => ({ status: 404, body: { error: { message: 'Not Found' } } }));
  const app = createApp(config, fn);
  assert.equal((await request(app).post('/api/location').send({})).status, 400);
  const res = await request(app).post('/api/location').send({ cellTowers: [{ cellId: 1 }] });
  assert.equal(res.status, 404);
  assert.equal((await request(app).post('/api/location').set('Content-Type', 'application/json').send('{bad')).status, 400);
});

test('TtlCache expires entries and dedupes concurrent loads', async () => {
  let now = 0;
  let loads = 0;
  const cache = new TtlCache<number>(1000, 10, () => now);
  const load = async () => ++loads;
  await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
  assert.equal(loads, 1);
  now = 1001;
  assert.equal(await cache.getOrLoad('k', load), 2);
});
