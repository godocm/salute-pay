import assert from 'node:assert/strict';
import { test } from 'node:test';
import jobs from '../scripts/neon-jobs-function.mjs';

const scheduled = () => new Request('https://jobs.example/', {
  method: 'POST', headers: { 'x-neon-trigger-invocation-id': 'test-occurrence' },
  body: JSON.stringify({ data: { scheduled_at: '2026-10-12T00:00:00Z' } }),
});
test('rejects ordinary callers before making any authenticated outbound call', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected network call'); });
  assert.equal((await jobs.fetch(new Request('https://jobs.example/', { method: 'POST' }))).status, 403);
  assert.equal(outbound.mock.callCount(), 0);
});
test('forwards the scheduled call with server authorization and rejects redirects', async t => {
  const originalOrigin = process.env.APP_ORIGIN, originalSecret = process.env.CRON_SECRET;
  process.env.APP_ORIGIN = 'https://salutepay.vercel.app';
  process.env.CRON_SECRET = 'local-unit-test-only';
  t.after(() => {
    if (originalOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = originalOrigin;
    if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
  });
  const outbound = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://salutepay.vercel.app/api/jobs');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer local-unit-test-only');
    assert.equal(options.redirect, 'error');
    return Response.json({ watcher: {}, webhooks: {} });
  });
  const response = await jobs.fetch(scheduled());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: 200, watcherErrors: 0 });
  assert.equal(outbound.mock.callCount(), 1);
});
test('reports upstream errors without disclosing the credential or response body', async t => {
  const originalOrigin = process.env.APP_ORIGIN, originalSecret = process.env.CRON_SECRET;
  process.env.APP_ORIGIN = 'https://salutepay.vercel.app';
  process.env.CRON_SECRET = 'local-unit-test-only';
  t.after(() => {
    if (originalOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = originalOrigin;
    if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('Private upstream detail', { status: 503 }));
  const response = await jobs.fetch(scheduled());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, status: 503, watcherErrors: 0 });
});
test('surfaces chain watcher errors even when the API returns HTTP 200', async t => {
  const originalOrigin = process.env.APP_ORIGIN, originalSecret = process.env.CRON_SECRET;
  process.env.APP_ORIGIN = 'https://salutepay.vercel.app';
  process.env.CRON_SECRET = 'local-unit-test-only';
  t.after(() => {
    if (originalOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = originalOrigin;
    if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
  });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ watcher: { scanned: 0, errors: 1 } }));
  const response = await jobs.fetch(scheduled());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, status: 200, watcherErrors: 1 });
});
