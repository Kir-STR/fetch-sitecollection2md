import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { defaultRoot, localDate, REPO_DIR } from '../lib/paths.js';

test('default root is !all/data/my/tools/fetch-sitecollection2md', () => {
  assert.equal(
    defaultRoot(resolve('/x/!all/code/my/tools/fetch-sitecollection2md')),
    resolve('/x/!all/data/my/tools/fetch-sitecollection2md'),
  );
});

test('REPO_DIR is the directory with package.json', () => {
  assert.equal(REPO_DIR, resolve(import.meta.dirname, '..'));
});

test('localDate formats local date', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
