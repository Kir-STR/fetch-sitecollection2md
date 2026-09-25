import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import adapter from '../adapters/awesomejev.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'awesomejev');

test('parses every table row with section, language, stars, links', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await adapter.fetch(ctx);
  const html = await readFile(join(fixtures, '001.txt'), 'utf8');
  assert.deepEqual(ctx.requested, ['https://awesomejev.com/']);
  assert.equal(records.length, html.split('<tr data-name=').length - 1);
  assert.equal(new Set(records.map(r => r.tags[0])).size, html.split('<section class="cat').length - 1);

  const r = records.find(x => x.title === 'agent-chaperone');
  assert.equal(r.url, 'https://github.com/agent-chaperone/agent-chaperone');
  assert.deepEqual(r.tags, ['Agent tooling', 'TypeScript']);
  assert.match(r.signal, /^\d+ stars$/);
  assert.equal(r.extra.owner, 'agent-chaperone');
  assert.equal(r.extra.repo, 'https://github.com/agent-chaperone/agent-chaperone');
  assert.equal(r.extra.site, 'https://agentchaperone.dev');
  assert.match(r.extra.added, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.description, /^Screens an AI agent's tool calls/);
});

test('rows without GitHub stars have null signal', async () => {
  const records = await adapter.fetch(await fixtureCtx(fixtures));
  assert.ok(records.some(r => r.signal === null));
  assert.ok(records.every(r => r.signal === null || /^\d+ stars$/.test(r.signal)));
  assert.ok(records.every(r => !r.tags.includes('—')));
});
