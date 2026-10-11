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
