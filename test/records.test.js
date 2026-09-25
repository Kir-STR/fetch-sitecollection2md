import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../lib/records.js';

test('fills source and defaults, trims title/url', () => {
  const { records } = normalize([{ title: ' A ', url: ' https://a ' }], 'c');
  assert.deepEqual(records, [{ title: 'A', url: 'https://a', source: 'c', description: '', tags: [], signal: null, extra: {} }]);
});

test('skips records without title or url', () => {
  const r = normalize([{ title: 'A', url: 'https://a' }, { title: '', url: 'https://b' }, { title: 'C' }, null], 'c');
  assert.equal(r.records.length, 1);
  assert.equal(r.skipped, 3);
});

test('dedups by url keeping the first', () => {
  const r = normalize([{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://a' }], 'c');
  assert.deepEqual(r.records.map(x => x.title), ['A']);
  assert.equal(r.duplicates, 1);
});

test('drops empty tags and empty extra values, keeps zero', () => {
  const { records } = normalize([{ title: 'A', url: 'https://a', tags: ['x', '', null], extra: { a: null, b: '', c: 0, d: 'v' } }], 'c');
  assert.deepEqual(records[0].tags, ['x']);
  assert.deepEqual(records[0].extra, { c: 0, d: 'v' });
});

test('throws when nothing valid', () => {
  assert.throws(() => normalize([{ title: 'A' }], 'c'), /c: no valid records \(got 1, skipped 1\)/);
});

test('throws when not an array', () => {
  assert.throws(() => normalize(undefined, 'c'), /c: adapter must return an array/);
});
