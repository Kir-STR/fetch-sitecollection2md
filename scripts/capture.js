// node scripts/capture.js <collection> [<url>...]
// С URL — скачивает их; без URL — прогоняет adapters/<collection>.js и записывает все его запросы.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGet } from '../lib/http.js';

const [collection, ...urls] = process.argv.slice(2);
if (!collection) { console.error('usage: node scripts/capture.js <collection> [<url>...]'); process.exit(2); }
if (!/^[a-z0-9-]+$/.test(collection)) { console.error(`bad collection name: ${collection}`); process.exit(2); }
const dir = join(import.meta.dirname, '..', 'test', 'fixtures', collection);
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });

const index = {};
const live = createGet();
async function get(url, init) {
  const res = await live(url, init);
  const body = Buffer.from(await res.arrayBuffer());
  const name = `${String(Object.keys(index).length + 1).padStart(3, '0')}.txt`;
  await writeFile(join(dir, name), body);
  index[url] = name;
  return new Response(body, { status: res.status });
}

if (urls.length) {
  for (const url of urls) await get(url);
} else {
  const { default: adapter } = await import(pathToFileURL(join(import.meta.dirname, '..', 'adapters', `${collection}.js`)).href);
  await adapter.fetch({ get, note() {} });
}
await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.error(`${Object.keys(index).length} fixtures -> ${dir}`);
