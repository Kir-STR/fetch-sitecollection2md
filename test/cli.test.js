import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cli = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, '..', 'fetch.js'), ...args], { encoding: 'utf8' });

test('no args -> usage, exit 2', () => {
  const r = cli();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node fetch\.js <collection> \[--out <root>\]/);
});

test('unknown flag -> usage, exit 2', () => {
  const r = cli('n8n', '--bogus');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});

for (const name of ['nope', '../lib/run', 'a/b', 'A']) {
  test(`unknown or unsafe collection "${name}" -> exit 2`, () => {
    const r = cli(name);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown collection/);
  });
}
