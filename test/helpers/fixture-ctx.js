import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function fixtureCtx(dir) {
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  const requested = [];
  const notes = [];
  return {
    requested,
    notes,
    note: text => notes.push(text),
    async get(url) {
      requested.push(url);
      const name = index[url];
      if (!name) throw new Error(`no fixture for ${url}`);
      return new Response(await readFile(join(dir, name)), { status: 200 });
    },
  };
}
