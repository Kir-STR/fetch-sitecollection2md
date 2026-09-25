import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMd, renderJsonl } from '../lib/render.js';

const rec = (o = {}) => ({ title: 'T', url: 'https://t', source: 'c', description: '', tags: [], signal: null, extra: {}, ...o });

test('header with notes, blocks omit empty fields', () => {
  const md = renderMd({
    collection: 'c', url: 'https://c', date: '2026-09-25', notes: ['top 5 of 9'],
    records: [rec({ description: 'D', tags: ['a', 'b'], signal: '3 views', extra: { k: 1 } }), rec({ title: 'U', url: 'https://u' })],
  });
  assert.equal(md, [
    '# c', '', '- source: https://c', '- date: 2026-09-25', '- records: 2', '- note: top 5 of 9',
    '', '## T', '- url: https://t', '- description: D', '- tags: a, b', '- signal: 3 views', '- extra: {"k":1}',
    '', '## U', '- url: https://u', '',
  ].join('\n'));
});

test('newlines in title and description do not break blocks', () => {
  const md = renderMd({ collection: 'c', url: 'u', date: 'd', notes: [], records: [rec({ title: 'A\n## B', description: 'x\n\ny' })] });
  assert.match(md, /^## A ## B$/m);
  assert.match(md, /^- description: x y$/m);
  assert.equal(md.match(/^## /gm).length, 1);
});

test('jsonl has one record per line and no notes', () => {
  const lines = renderJsonl([rec(), rec({ url: 'https://u' })]).trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), rec({ url: 'https://u' }));
});
