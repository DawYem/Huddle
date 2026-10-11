import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadCatalog } from '../src/huddle/catalog.js';
import { toE164 } from '../src/huddle/phone.js';
import { Store } from '../src/huddle/store.js';

const DATA = join(import.meta.dirname, '..', 'data');

function setup(huddleNumber?: string) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'));
  const app = createApp(
    { googleApiKey: 'k', port: 0, rateLimitPerMinute: 1000, cacheTtlMs: 1000, huddleNumber },
    fetch,
    { catalog: loadCatalog(join(DATA, 'games.json'), join(DATA, 'perks.json')), store },
  );
  return { app, store };
}

const valid = { firstName: 'Sam', lastName: 'Lee', phone: '(404) 555-0123', email: 'Sam@Example.com' };

test('toE164 accepts common US formats and explicit country codes', () => {
  assert.equal(toE164('(404) 555-0123'), '+14045550123');
  assert.equal(toE164('404.555.0123'), '+14045550123');
  assert.equal(toE164('1 404 555 0123'), '+14045550123');
  assert.equal(toE164('+44 20 7946 0958'), '+442079460958');
  assert.equal(toE164('555-0123'), undefined);
  assert.equal(toE164('(004) 555-0123'), undefined);
  assert.equal(toE164('+0123456789'), undefined);
});

test('POST /api/fans saves the fan under their E.164 number', async () => {
  const { app, store } = setup('+15557654321');
  const res = await request(app).post('/api/fans').send(valid);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, {
    handle: '+14045550123',
    created: true,
    textedHuddle: false,
    huddleNumber: '+15557654321',
    // No Photon credentials in this setup.
    spectrumSynced: false,
  });
  const fan = store.getFan('+14045550123');
  assert.equal(fan?.name, 'Sam Lee');
  assert.equal(fan?.email, 'sam@example.com');
  // Website sign-up never confirms age or opts them in to texts.
  assert.equal(fan?.is21Plus, false);
  assert.equal(fan?.textedFirst, false);
});

test('POST /api/fans again updates the fan and keeps their opt-in', async () => {
  const { app, store } = setup();
  await request(app).post('/api/fans').send(valid);
  store.upsertFan('+14045550123', { textedFirst: true });
  const res = await request(app).post('/api/fans').send({ ...valid, firstName: 'Samantha', phone: '+1 404 555 0123' });
  assert.equal(res.status, 200);
  assert.equal(res.body.created, false);
  assert.equal(res.body.textedHuddle, true);
  assert.equal(res.body.huddleNumber, null);
  assert.equal(store.getFan('+14045550123')?.name, 'Samantha Lee');
  assert.equal(store.fans().length, 1);
});

test('POST /api/fans returns per-field errors and saves nothing', async () => {
  const { app, store } = setup();
  const res = await request(app)
    .post('/api/fans')
    .send({ firstName: ' ', lastName: 'Lee', phone: '555-0123', email: 'nope' });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.body.fields).sort(), ['email', 'firstName', 'phone']);
  assert.equal(store.fans().length, 0);

  const notJson = await request(app).post('/api/fans').set('Content-Type', 'application/json').send('{bad');
  assert.equal(notJson.status, 400);
});

test('game sign-up accepts the same phone formats as the website form', async () => {
  const { app, store } = setup();
  const res = await request(app).post('/api/games/nfl-giants-eagles-1019/signups').send({ handle: '(404) 555-0123' });
  assert.equal(res.status, 201);
  assert.equal(res.body.handle, '+14045550123');
  assert.equal(store.signupsFor('+14045550123').length, 1);
});

const PROJECT = '11111111-2222-4333-8444-555555555555';
const spectrum = { projectId: PROJECT, projectSecret: 's3cret', userType: 'shared' as const };

function withPhoton(fetchFn: typeof fetch) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'huddle-')), 'store.json'));
  const app = createApp(
    { googleApiKey: 'k', port: 0, rateLimitPerMinute: 1000, cacheTtlMs: 1000, huddleNumber: '+15550000000', spectrum },
    fetchFn,
    { catalog: loadCatalog(join(DATA, 'games.json'), join(DATA, 'perks.json')), store },
  );
  return { app, store };
}

test('sign-up adds the fan to Photon Users with the same four fields', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const sent = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        succeed: true,
        data: { id: 'user-1', projectId: PROJECT, type: 'shared', ...sent, assignedPhoneNumber: '+16285550111', meta: null, createdAt: 'now' },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const { app, store } = withPhoton(fakeFetch);

  const res = await request(app).post('/api/fans').send(valid);
  assert.equal(res.status, 201);
  assert.equal(res.body.spectrumSynced, true);
  // The fan is shown the number Photon assigned them, not the fallback.
  assert.equal(res.body.huddleNumber, '+16285550111');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://spectrum.photon.codes/projects/${PROJECT}/users/`);
  assert.equal(calls[0].init.method, 'POST');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Basic ${Buffer.from(`${PROJECT}:s3cret`).toString('base64')}`);
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    type: 'shared',
    phoneNumber: '+14045550123',
    firstName: 'Sam',
    lastName: 'Lee',
    email: 'sam@example.com',
  });
  assert.equal(store.getFan('+14045550123')?.spectrumUserId, 'user-1');
  assert.equal(store.getFan('+14045550123')?.huddleNumber, '+16285550111');
});

test('a Photon outage still saves the sign-up and falls back to HUDDLE_NUMBER', async () => {
  const failing = (async () =>
    new Response(JSON.stringify({ succeed: false, message: 'maxSharedUsers reached' }), { status: 409 })) as unknown as typeof fetch;
  const { app, store } = withPhoton(failing);
  const res = await request(app).post('/api/fans').send(valid);
  assert.equal(res.status, 201);
  assert.equal(res.body.spectrumSynced, false);
  assert.equal(res.body.huddleNumber, '+15550000000');
  assert.equal(store.getFan('+14045550123')?.name, 'Sam Lee');
});

test('dedicated plans send the project line as assignedPhoneNumber', async () => {
  let sent: Record<string, unknown> = {};
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ succeed: true, data: { id: 'u', assignedPhoneNumber: '+15557654321' } }), { status: 200 });
  }) as typeof fetch;
  const { spectrumUsers } = await import('../src/photon/users.js');
  const register = spectrumUsers({ ...spectrum, userType: 'dedicated', dedicatedLine: '+15557654321' }, fakeFetch);
  const user = await register({ phoneNumber: '+14045550123', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' });
  assert.equal(sent.type, 'dedicated');
  assert.equal(sent.assignedPhoneNumber, '+15557654321');
  assert.equal(user.assignedPhoneNumber, '+15557654321');
});
