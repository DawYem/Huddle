import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/createApp.js';
import type { Config } from '../src/config.js';
import { directionsUrl } from '../src/maps/directions.js';
import { filterEligible } from '../src/recommendations/eligibility.js';
import { fallbackRank, validatePicks } from '../src/recommendations/rank.js';
import type { WatchSpot } from '../src/google/places.js';

const config: Config = {
  googleApiKey: 'test-key',
  port: 0,
  rateLimitPerMinute: 1000,
  cacheTtlMs: 60_000,
  geminiApiKey: 'gemini-test-key',
  geminiModel: 'test-model',
};

// Places sits at the origin (0, 0); larger lat means farther away.
const place = (id: string, lat: number, primaryType: string | undefined, openNow = true) => ({
  id,
  displayName: { text: `Place ${id}` },
  location: { latitude: lat, longitude: 0 },
  primaryType,
  rating: 4.5,
  userRatingCount: 100,
  currentOpeningHours: { openNow },
});

const PLACES = [
  place('bar1', 0.001, 'bar'),
  place('cafe1', 0.002, 'cafe'),
  place('rest1', 0.003, 'restaurant'),
  place('rest2', 0.004, 'restaurant', false),
  place('mystery', 0.005, undefined),
];

const geminiReply = (picks: unknown) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ picks }) }] } }],
});

// Answers Places and Gemini calls separately, and records every call.
function mockGoogle(gemini: () => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = url.includes('generativelanguage')
      ? gemini()
      : { body: { places: PLACES } };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  const geminiCalls = () => calls.filter((c) => c.url.includes('generativelanguage'));
  return { fn, calls, geminiCalls };
}

const ids = (res: request.Response) => res.body.recommendations.map((r: { id: string }) => r.id);

test('uses Gemini order, reasons and adds directions links', async () => {
  const { fn, geminiCalls } = mockGoogle(() => ({
    body: geminiReply([
      { id: 'rest1', reason: 'Great rating and a short walk.' },
      { id: 'bar1', reason: 'Closest spot for a lively crowd.' },
    ]),
  }));
  const res = await request(createApp(config, fn)).get('/api/recommendations?lat=0&lng=0&team=Hawks&is21=true');

  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'gemini');
  assert.deepEqual(ids(res), ['rest1', 'bar1']);
  assert.equal(res.body.recommendations[0].reason, 'Great rating and a short walk.');
  assert.match(res.body.recommendations[0].directionsUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);

  const [call] = geminiCalls();
  assert.match(call.url, /models\/test-model:generateContent$/);
  assert.doesNotMatch(call.url, /gemini-test-key/, 'key must not be in the URL');
  assert.equal((call.init.headers as Record<string, string>)['x-goog-api-key'], 'gemini-test-key');
  const sent = JSON.parse(String(call.init.body));
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.match(sent.contents[0].parts[0].text, /"team":"Hawks"/);
});

test('drops invented and repeated ids and replaces "showing" claims', async () => {
  const { fn } = mockGoogle(() => ({
    body: geminiReply([
      { id: 'made-up', reason: 'Does not exist' },
      { id: 'cafe1', reason: 'They are showing the Hawks game on big screens!' },
      { id: 'cafe1', reason: 'Repeat' },
      { id: 'rest1', reason: 'Quiet and close.' },
    ]),
  }));
  const res = await request(createApp(config, fn)).get('/api/recommendations?lat=0&lng=0&is21=true');

  assert.equal(res.body.source, 'gemini');
  assert.deepEqual(ids(res), ['cafe1', 'rest1']);
  assert.doesNotMatch(res.body.recommendations[0].reason, /show|screen/i);
  assert.match(res.body.recommendations[0].reason, /mi away/);
});

test('without confirmed 21+, bars and untyped places never reach Gemini or the response', async () => {
  const { fn, geminiCalls } = mockGoogle(() => ({
    // Even if Gemini returns a bar, it was never a candidate, so it is discarded.
    body: geminiReply([{ id: 'bar1', reason: 'x' }, { id: 'cafe1', reason: 'Cozy cafe nearby.' }]),
  }));
  const res = await request(createApp(config, fn)).get('/api/recommendations?lat=0&lng=0');

  assert.deepEqual(ids(res), ['cafe1']);
  const prompt = JSON.parse(String(geminiCalls()[0].init.body)).contents[0].parts[0].text as string;
  assert.doesNotMatch(prompt, /bar1|mystery/);
  assert.match(prompt, /cafe1/);
});

test('falls back to open-now then nearest when Gemini errors', async () => {
  const { fn } = mockGoogle(() => ({ status: 500, body: { error: { message: 'boom' } } }));
  const res = await request(createApp(config, fn)).get('/api/recommendations?lat=0&lng=0&is21=true');

  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'fallback');
  assert.deepEqual(ids(res), ['bar1', 'cafe1', 'rest1']);
  assert.match(res.body.recommendations[0].reason, /open now, rated 4\.5 \(100 reviews\)/);
});

test('falls back when Gemini returns unusable output', async () => {
  for (const body of [
    { candidates: [{ content: { parts: [{ text: 'not json' }] } }] },
    { candidates: [] },
    geminiReply([{ id: 'nope', reason: 'x' }]),
  ]) {
    const { fn } = mockGoogle(() => ({ body }));
    const res = await request(createApp(config, fn)).get('/api/recommendations?lat=0&lng=0');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'fallback');
    // Not 21+: only cafe1 and the two restaurants are eligible; rest2 is closed so it goes last.
    assert.deepEqual(ids(res), ['cafe1', 'rest1', 'rest2']);
  }
});

test('without a Gemini key, uses the fallback and never calls Gemini', async () => {
  const { fn, geminiCalls } = mockGoogle(() => ({ body: geminiReply([]) }));
  const res = await request(createApp({ ...config, geminiApiKey: undefined }, fn)).get(
    '/api/recommendations?lat=0&lng=0',
  );
  assert.equal(res.body.source, 'fallback');
  assert.equal(geminiCalls().length, 0);
});

test('rejects bad input without calling Google', async () => {
  const { fn, calls } = mockGoogle(() => ({ body: {} }));
  const app = createApp(config, fn);
  for (const qs of ['lng=0', 'lat=0&lng=0&is21=yes', 'lat=0&lng=0&team=%7Bignore%20rules%7D', `lat=0&lng=0&vibe=${'a'.repeat(41)}`]) {
    assert.equal((await request(app).get(`/api/recommendations?${qs}`)).status, 400, qs);
  }
  assert.equal(calls.length, 0);
});

test('Places errors still surface as 502', async () => {
  const fn = (async () =>
    new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 403 })) as unknown as typeof fetch;
  const res = await request(createApp(config, fn)).get('/api/recommendations?lat=0&lng=0');
  assert.equal(res.status, 502);
});

test('directionsUrl builds a keyless Google Maps link', () => {
  assert.equal(
    directionsUrl({ id: 'ChIJabc', lat: 33.749, lng: -84.388 }),
    'https://www.google.com/maps/dir/?api=1&destination=33.749%2C-84.388&destination_place_id=ChIJabc',
  );
});

test('unit: filterEligible, fallbackRank and validatePicks', () => {
  const spot = (id: string, primaryType: string | undefined, distanceMeters: number, openNow?: boolean): WatchSpot => ({
    id, name: id, lat: 0, lng: 0, distanceMeters, primaryType, openNow,
  });
  const spots = [spot('pub', 'pub', 10), spot('cafe', 'cafe', 30), spot('diner', 'restaurant', 20, true)];

  assert.deepEqual(filterEligible(spots, { is21Plus: false }).map((s) => s.id), ['cafe', 'diner']);
  assert.equal(filterEligible(spots, { is21Plus: true }).length, 3);
  assert.deepEqual(fallbackRank(spots).map((r) => r.spot.id), ['diner', 'pub', 'cafe']);
  assert.deepEqual(validatePicks(null, spots), []);
  assert.deepEqual(validatePicks({ picks: 'nope' }, spots), []);
  const many = validatePicks({ picks: spots.concat(spot('x', 'cafe', 1)).map((s) => ({ id: s.id, reason: 'ok' })) }, [
    ...spots,
    spot('x', 'cafe', 1),
  ]);
  assert.equal(many.length, 3, 'caps at 3 picks');
});
