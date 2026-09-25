import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSnapshot } from '../lib/snapshot.js';

const tmp = () => mkdtemp(join(tmpdir(), 'snap-'));

test('writes both files as UTF-8 without BOM', async () => {
  const dir = join(await tmp(), 'c');
  const [jsonl, md] = await writeSnapshot(dir, '2026-09-25', { md: '# Привет ★ …\n', jsonl: '{"t":"Ёж 🦔"}\n' });
  assert.equal(md, join(dir, '2026-09-25.md'));
  assert.equal(jsonl, join(dir, '2026-09-25.jsonl'));
  const bytes = await readFile(md);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(bytes.toString('utf8'), '# Привет ★ …\n');
  assert.deepEqual(JSON.parse(await readFile(jsonl, 'utf8')), { t: 'Ёж 🦔' });
  assert.deepEqual((await readdir(dir)).sort(), ['2026-09-25.jsonl', '2026-09-25.md']);
});

test('same-day rerun replaces the snapshot', async () => {
  const dir = await tmp();
  await writeSnapshot(dir, 'd', { md: 'old', jsonl: 'old' });
  await writeSnapshot(dir, 'd', { md: 'new', jsonl: 'new' });
  assert.equal(await readFile(join(dir, 'd.md'), 'utf8'), 'new');
  assert.equal(await readFile(join(dir, 'd.jsonl'), 'utf8'), 'new');
});

test('failure while preparing temp files keeps the existing snapshot', async () => {
  const dir = await tmp();
  await writeFile(join(dir, 'd.md'), 'old md');
  await writeFile(join(dir, 'd.jsonl'), 'old jsonl');
  await mkdir(join(dir, 'd.md.tmp'));          // writeFile на каталог падает (EISDIR/EPERM)
  await assert.rejects(writeSnapshot(dir, 'd', { md: 'new', jsonl: 'new' }));
  assert.equal(await readFile(join(dir, 'd.md'), 'utf8'), 'old md');
  assert.equal(await readFile(join(dir, 'd.jsonl'), 'utf8'), 'old jsonl');
  assert.ok(!(await readdir(dir)).includes('d.jsonl.tmp'));
});
