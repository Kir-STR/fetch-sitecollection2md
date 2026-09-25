import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../lib/run.js';

const adapter = records => ({ url: 'https://c', async fetch(ctx) { ctx.note('slice note'); return records; } });

test('writes snapshot with notes in md only and reports counts', async () => {
  const outRoot = await mkdtemp(join(tmpdir(), 'run-'));
  const logs = [];
  const r = await run({
    collection: 'c', outRoot, date: '2026-09-25', get: null, log: m => logs.push(m),
    adapter: adapter([{ title: 'A', url: 'https://a' }, { title: 'A2', url: 'https://a' }, { title: '' }]),
  });
  assert.deepEqual([r.records.length, r.skipped, r.duplicates], [1, 1, 1]);
  const md = await readFile(join(outRoot, 'c', '2026-09-25.md'), 'utf8');
  const jsonl = await readFile(join(outRoot, 'c', '2026-09-25.jsonl'), 'utf8');
  assert.match(md, /^- note: slice note$/m);
  assert.doesNotMatch(jsonl, /slice note/);
  assert.equal(JSON.parse(jsonl.trim()).source, 'c');
  assert.ok(logs.some(l => /skipped 1 invalid/.test(l)));
  assert.ok(logs.some(l => /c: 1 records, 1 skipped, 1 duplicates/.test(l)));
});

test('adapter error writes nothing', async () => {
  const outRoot = await mkdtemp(join(tmpdir(), 'run-'));
  const bad = { url: 'u', async fetch() { throw new Error('boom'); } };
  await assert.rejects(run({ collection: 'c', outRoot, date: 'd', get: null, adapter: bad, log() {} }), /boom/);
  assert.deepEqual(await readdir(outRoot), []);
});

test('zero valid records writes nothing', async () => {
  const outRoot = await mkdtemp(join(tmpdir(), 'run-'));
  await assert.rejects(run({ collection: 'c', outRoot, date: 'd', get: null, adapter: adapter([{ title: 'x' }]), log() {} }), /no valid records/);
  assert.deepEqual(await readdir(outRoot), []);
});
