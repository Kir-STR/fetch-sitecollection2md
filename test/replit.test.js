import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import adapter, { galleryPages } from '../adapters/replit.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'replit');

test('galleryPages finds nested galleryPage objects', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ a: [{ b: { _type: 'galleryPage', slug: 's' } }] })}</script>`;
  assert.deepEqual(galleryPages(html).map(p => p.slug), ['s']);
  assert.throws(() => galleryPages('<html></html>'), /__NEXT_DATA__ not found/);
});

test('collects gallery plus sitemap-only entries without duplicates', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await adapter.fetch(ctx);
  assert.deepEqual(ctx.requested.slice(0, 2), ['https://replit.com/gallery', 'https://replit.com/marketing-sitemap/sitemap.xml']);
  assert.equal(new Set(records.map(r => r.url)).size, records.length);

  const index = JSON.parse(await readFile(join(fixtures, 'index.json'), 'utf8'));
  const sitemap = await readFile(join(fixtures, index['https://replit.com/marketing-sitemap/sitemap.xml']), 'utf8');
  const slugs = new Set([...sitemap.matchAll(/\/gallery\/[^/<]+\/[^/<]+\/([^/<]+)<\/loc>/g)].map(m => m[1]));
  const got = new Set(records.map(r => r.url.split('/').pop()));
  assert.deepEqual([...slugs].filter(s => !got.has(s)), []);
  assert.deepEqual(ctx.notes, []);

  const r = records.find(x => x.url === 'https://replit.com/gallery/life/entertainment/sf-park-mapper');
  assert.equal(r.title, 'SF Park Mapper');
  assert.equal(r.description, 'Discover San Francisco parks and outdoor activities');
  assert.ok(r.tags.includes('Entertainment'));
  assert.match(r.signal, /^\d+ views$/);
  assert.equal(r.extra.creator, 'Matt Palmer');
  assert.equal(typeof r.extra.remixCount, 'number');
  assert.ok(r.extra.types.includes('App'));
});
