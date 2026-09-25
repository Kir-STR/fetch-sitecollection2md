#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './lib/run.js';
import { createGet } from './lib/http.js';
import { REPO_DIR, defaultRoot, localDate } from './lib/paths.js';

const usage = () => { console.error('usage: node fetch.js <collection> [--out <root>]'); process.exit(2); };
let values, positionals;
try {
  ({ values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } }));
} catch {
  usage();
}
if (positionals.length !== 1) usage();
const [collection] = positionals;
const file = join(REPO_DIR, 'adapters', `${collection}.js`);
if (!/^[a-z0-9-]+$/.test(collection) || !existsSync(file)) {
  console.error(`unknown collection: ${collection}`);
  process.exit(2);
}
try {
  const { default: adapter } = await import(pathToFileURL(file).href);
  await run({
    collection,
    adapter,
    outRoot: values.out ? resolve(values.out) : defaultRoot(),
    get: createGet({ delayMs: adapter.delayMs ?? 1000 }),
    date: localDate(),
  });
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
}
