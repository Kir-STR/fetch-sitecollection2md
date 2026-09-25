import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Оба файла сначала целиком во временные, затем rename: .jsonl, потом .md.
// Остаточный риск (спека): сбой между двумя rename оставляет новый .jsonl при старом/отсутствующем .md.
export async function writeSnapshot(dir, date, { md, jsonl }) {
  await mkdir(dir, { recursive: true });
  const files = [[`${date}.jsonl`, jsonl], [`${date}.md`, md]]
    .map(([name, body]) => ({ final: join(dir, name), tmp: join(dir, `${name}.tmp`), body }));
  try {
    for (const f of files) await writeFile(f.tmp, f.body, 'utf8');
  } catch (e) {
    await Promise.allSettled(files.map(f => rm(f.tmp, { force: true })));
    throw e;
  }
  for (const f of files) await rename(f.tmp, f.final);
  return files.map(f => f.final);
}
