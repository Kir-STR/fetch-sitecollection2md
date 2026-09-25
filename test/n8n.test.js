import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import adapter, { fetchTop, trimDescription } from '../adapters/n8n.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const API = 'https://api.n8n.io/templates/search';
const fixtures = join(import.meta.dirname, 'fixtures', 'n8n');

test('trimDescription collapses whitespace and cuts with ellipsis within limit', () => {
  assert.equal(trimDescription('  a\n\n b\tc '), 'a b c');
  const long = trimDescription('x'.repeat(600));
  assert.equal(long.length, 500);
  assert.ok(long.endsWith('…'));
  assert.equal(trimDescription(undefined), '');
});

test('fetchTop pages until limit and maps records', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await fetchTop(ctx, { limit: 5, rows: 2 });
  assert.deepEqual(ctx.requested, [1, 2, 3].map(p => `${API}?page=${p}&rows=2&sort=views:desc`));
  assert.equal(records.length, 5);
  const [top] = records;
  assert.equal(top.url, 'https://n8n.io/workflows/1954');
  assert.equal(top.title, 'AI agent chat');
  assert.equal(top.extra.author, 'n8n-team');
  assert.ok(top.extra.nodes.includes('AI Agent'));
  assert.equal(top.extra.price, 0);
  for (const r of records) {
    assert.match(r.signal, /^\d+ views$/);
    assert.ok(r.description.length <= 500 && !/\n/.test(r.description));
  }
  assert.equal(ctx.notes.length, 1);
  assert.match(ctx.notes[0], /^top 5 of \d+ templates by views \(desc\)$/);
});

const memCtx = pages => ({
  note() {},
  async get(url) {
    const page = Number(new URL(url).searchParams.get('page'));
    return Response.json(pages[page - 1]);
  },
});
const wf = id => ({ id, name: `w${id}`, totalViews: 1, nodes: [] });

test('empty page before expected count is an error', async () => {
  const ctx = memCtx([{ totalWorkflows: 100, workflows: [wf(1), wf(2)] }, { totalWorkflows: 100, workflows: [] }]);
  await assert.rejects(fetchTop(ctx, { limit: 5, rows: 2 }), /n8n: page 2 empty after 2 of 5 expected/);
});

test('short page before expected count is an error', async () => {
  const ctx = memCtx([{ totalWorkflows: 100, workflows: [wf(1)] }]);
  await assert.rejects(fetchTop(ctx, { limit: 5, rows: 2 }), /n8n: page 1 short \(1 of 2\) after 1 of 5 expected/);
});

test('catalog smaller than limit takes all', async () => {
  const ctx = memCtx([{ totalWorkflows: 3, workflows: [wf(1), wf(2)] }, { totalWorkflows: 3, workflows: [wf(3)] }]);
  assert.equal((await fetchTop(ctx, { limit: 5, rows: 2 })).length, 3);
});

test('API error payload is reported', async () => {
  const ctx = memCtx([{ data: null, error: { status: 400, message: 'Parameter `sort_by` is malformed.' } }]);
  await assert.rejects(fetchTop(ctx, { limit: 5, rows: 2 }), /n8n: unexpected response on page 1: .*sort_by/);
});

test('default export targets top 1000 by views', () => {
  assert.equal(adapter.url, 'https://n8n.io/workflows/');
});
