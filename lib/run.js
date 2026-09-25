import { join } from 'node:path';
import { normalize } from './records.js';
import { renderMd, renderJsonl } from './render.js';
import { writeSnapshot } from './snapshot.js';

export async function run({ collection, adapter, outRoot, get, date, log = console.error }) {
  const notes = [];
  const ctx = { get, note: text => notes.push(String(text)) };
  const { records, skipped, duplicates } = normalize(await adapter.fetch(ctx), collection);
  if (skipped) log(`warning: skipped ${skipped} invalid records`);
  const files = await writeSnapshot(join(outRoot, collection), date, {
    md: renderMd({ collection, url: adapter.url, date, notes, records }),
    jsonl: renderJsonl(records),
  });
  log(`${collection}: ${records.length} records, ${skipped} skipped, ${duplicates} duplicates -> ${files[1]}`);
  return { records, skipped, duplicates, files };
}
