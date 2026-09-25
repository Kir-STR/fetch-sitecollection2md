import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createGet, retryAfterMs } from '../lib/http.js';

async function serve(handler) {
  let hits = 0;
  const server = createServer((req, res) => handler(req, res, ++hits));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return { url, hits: () => hits, close: () => { server.closeAllConnections(); return new Promise(r => server.close(r)); } };
}

function fastGet(opts = {}) {
  const sleeps = [];
  const get = createGet({ delayMs: 0, backoffMs: 5, sleep: ms => { sleeps.push(ms); return Promise.resolve(); }, ...opts });
  return { get, sleeps };
}

test('200 returns Response and sends User-Agent', async () => {
  let ua;
  const s = await serve((req, res) => { ua = req.headers['user-agent']; res.end('ok'); });
  try {
    const { get } = fastGet();
    assert.equal(await (await get(s.url)).text(), 'ok');
    assert.equal(ua, 'fetch-sitecollection2md/0.1');
  } finally { await s.close(); }
});

test('404 throws at once with url and status', async () => {
  const s = await serve((req, res) => { res.statusCode = 404; res.end(); });
  try {
    const { get } = fastGet();
    await assert.rejects(get(s.url), new RegExp(`GET ${s.url} -> 404`));
    assert.equal(s.hits(), 1);
  } finally { await s.close(); }
});

test('5xx then success is retried', async () => {
  const s = await serve((req, res, n) => { res.statusCode = n === 1 ? 502 : 200; res.end('ok'); });
  try {
    const { get } = fastGet();
    assert.equal((await get(s.url)).status, 200);
    assert.equal(s.hits(), 2);
  } finally { await s.close(); }
});

test('exhausted attempts throw with last reason', async () => {
  const s = await serve((req, res) => { res.statusCode = 503; res.end(); });
  try {
    const { get } = fastGet();
    await assert.rejects(get(s.url), /failed after 3 attempts: status 503/);
    assert.equal(s.hits(), 3);
  } finally { await s.close(); }
});

test('429 honours Retry-After seconds', async () => {
  const s = await serve((req, res, n) => {
    if (n === 1) { res.statusCode = 429; res.setHeader('retry-after', '2'); }
    res.end('ok');
  });
  try {
    const { get, sleeps } = fastGet();
    assert.equal((await get(s.url)).status, 200);
    assert.deepEqual(sleeps, [2000]);
  } finally { await s.close(); }
});

test('429 honours Retry-After HTTP date', async () => {
  const s = await serve((req, res, n) => {
    if (n === 1) { res.statusCode = 429; res.setHeader('retry-after', new Date(Date.now() + 5000).toUTCString()); }
    res.end('ok');
  });
  try {
    const { get, sleeps } = fastGet();
    await get(s.url);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 3000 && sleeps[0] <= 5000, `slept ${sleeps[0]}`);
  } finally { await s.close(); }
});

test('Retry-After is capped', () => {
  assert.equal(retryAfterMs('3600', 60000), 60000);
  assert.equal(retryAfterMs('garbage', 60000), null);
  assert.equal(retryAfterMs(null, 60000), null);
});

test('network error is retried and reported', async () => {
  const s = await serve((req, res) => res.end());
  const url = s.url;
  await s.close();
  const { get } = fastGet();
  await assert.rejects(get(url), /failed after 3 attempts: ECONNREFUSED/);
});

test('attempt timeout is retried', async () => {
  const s = await serve((req, res, n) => { if (n > 1) res.end('ok'); });
  try {
    const { get } = fastGet({ timeoutMs: 100 });
    assert.equal(await (await get(s.url)).text(), 'ok');
    assert.equal(s.hits(), 2);
  } finally { await s.close(); }
});

test('paces requests by delayMs', async () => {
  const s = await serve((req, res) => res.end('ok'));
  try {
    const { get, sleeps } = fastGet({ delayMs: 1000 });
    await get(s.url);
    await get(s.url);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 500 && sleeps[0] <= 1000, `slept ${sleeps[0]}`);
  } finally { await s.close(); }
});
