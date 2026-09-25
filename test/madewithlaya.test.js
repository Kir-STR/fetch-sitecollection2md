import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import adapter from '../adapters/madewithlaya.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const BASE = 'https://www.madewithlaya.com';
const fixtures = join(import.meta.dirname, 'fixtures', 'madewithlaya');

test('walks pages until there is no next link and parses cards', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await adapter.fetch(ctx);
  assert.deepEqual(ctx.requested, [`${BASE}/`, `${BASE}/page/2`, `${BASE}/page/3`]);

  const index = JSON.parse(await readFile(join(fixtures, 'index.json'), 'utf8'));
  let cards = 0;
  for (const file of Object.values(index)) cards += (await readFile(join(fixtures, file), 'utf8')).split('<article').length - 1;
  assert.equal(records.length, cards);

  const r = records.find(x => x.url === `${BASE}/builds/agentic-graphrag-10k-laya-shadow`);
  assert.equal(r.title, 'Agentic GraphRAG over S&P 10-Ks with Laya as a shadow decision engine beside Jev');
  assert.deepEqual(r.tags, ['Documents & data']);
  assert.equal(r.extra.author, 'Anthony ALCARAZ');
  assert.equal(r.extra.sourceUrl, 'https://github.com/AnthonyAlcaraz/aiven-agentic-graphrag-demo');
  assert.equal(r.extra.kind, 'GitHub');
  assert.match(r.description, /^Anthony Alcaraz's talk demo/);
  assert.ok(records.every(x => x.signal === null));
  assert.deepEqual(ctx.notes, ['upvotes not available (SSR renders 0)']);
});
