# fetch-sitecollection2md v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI `node fetch.js <collection>`, который собирает коллекцию через адаптер и пишет датированный снимок
`YYYY-MM-DD.md` + `YYYY-MM-DD.jsonl`; четыре адаптера v1: n8n, awesomejev, replit, madewithlaya.

**Architecture:** Ядро (`lib/`) — HTTP с паузами/повторами/тайм-аутом, нормализация записей, рендер, атомарная
запись файлов, оркестрация `run()`. Адаптер — один файл `adapters/<collection>.js` с
`export default { url, delayMs?, async fetch(ctx) }`; `ctx = { get(url) → Response, note(text) }`.
CLI (`fetch.js`) — тонкая обёртка: аргументы, загрузка адаптера, код выхода.

**Tech Stack:** Node ≥ 20.18.1 (локально v24.16.0), ESM, чистый JS без сборки, встроенные `fetch` и `node:test`,
`cheerio@^1.2.0` (только HTML-адаптеры).

**Spec:** `docs/superpowers/specs/2026-09-25-fetch-sitecollection2md-design.md`

## Global Constraints

- ESM (`"type": "module"`), JS без сборки и без TypeScript.
- Единственная зависимость — `cheerio@^1.2.0`; других не добавлять (тесты — `node:test`, HTTP — встроенный `fetch`).
- `engines.node`: `>=20.18.1` (требование cheerio 1.2.0).
- Имена файлов, веток — ASCII.
- User-Agent всех запросов: `fetch-sitecollection2md/0.1` (проверено: все четыре источника отвечают 200).
- Пауза между запросами по умолчанию 1000 мс; тайм-аут попытки 30 000 мс; 3 попытки; `Retry-After` ≤ 60 000 мс.
- Корень снимков по умолчанию — `<repo>/../../../../data/my/tools/fetch-sitecollection2md` (= `!all/data/my/tools/fetch-sitecollection2md`).
- Файлы снимка — UTF-8 без BOM, перевод строки `\n`.
- Коммиты — только если пользователь явно разрешил их при выборе способа исполнения (личное правило: «не коммитить без явной просьбы»). Шаги «Commit» без разрешения пропускаются, изменения остаются в рабочем дереве.
- Проверка «готово» — `npm test` с кодом 0 и живые прогоны Task 9.
- Экспериментальный инструмент: простота важнее полноты. Не добавлять сверх плана обработку редких сбоев, конфиги, абстракции.

## Review Focus

1. **Запуск из git worktree.** `defaultRoot()` считается от расположения репо; из `.worktrees/<name>` путь уйдёт мимо `!all/data`. Ожидание: живые прогоны идут из основного checkout или с явным `--out`. Закреплено: тест `defaultRoot` на конкретном пути (Task 3) и правило в Task 9.
2. **Переводы строк и `#` в title/description.** Заголовок `"A\n## B"` не должен порождать лишний блок в md. Ожидание: title/description рендерятся одной строкой. Закреплено: тест в Task 3.
3. **Не-ASCII (кириллица, эмодзи, `★`, `…`).** Ожидание: байты снимка — UTF-8 без BOM, JSONL читается обратно `JSON.parse` без потерь. Закреплено: тест в Task 3.
4. **n8n отвечает ошибкой в JSON** (`{"data":null,"error":{…}}` вместо `workflows`). Ожидание: понятная ошибка, снимок не пишется. Закреплено: тест в Task 5.
5. **Имя коллекции с обходом пути** (`../x`, `a/b`). Ожидание: код 2, `unknown collection`, никакой импорт вне `adapters/`. Закреплено: тест CLI в Task 4.

---

## File Structure

```
package.json            зависимости, engines, npm test
.gitignore              node_modules/
fetch.js                CLI
lib/records.js          normalize(): валидация, дедупликация, source, очистка extra
lib/http.js             createGet(): User-Agent, пауза, тайм-аут, повторы, Retry-After
lib/render.js           renderMd(), renderJsonl()
lib/snapshot.js         writeSnapshot(): temp + rename
lib/paths.js            REPO_DIR, defaultRoot(), localDate()
lib/run.js              run(): ctx, адаптер → normalize → render → write
adapters/n8n.js         JSON API, top-N по просмотрам
adapters/awesomejev.js  статический HTML
adapters/replit.js      __NEXT_DATA__ + sitemap
adapters/madewithlaya.js SSR HTML, пагинация
test/helpers/fixture-ctx.js  ctx.get из фикстур + журнал URL
scripts/capture.js      снятие фикстур (по URL или записью прогона адаптера); вне test/, чтобы node --test его не запускал
test/*.test.js          тесты
test/fixtures/<collection>/  index.json (url → файл) + 001.txt…
README.md               использование, добавление адаптера
```

---

### Task 1: Каркас и нормализация записей

**Files:**
- Create: `package.json`, `.gitignore`, `lib/records.js`
- Test: `test/records.test.js`

**Interfaces:**
- Produces: `normalize(records: unknown, source: string) → { records: Record[], skipped: number, duplicates: number }`,
  где `Record = { title, url, source, description: string, tags: string[], signal: string|null, extra: object }`.
  Бросает `Error`, если `records` не массив или валидных 0.

- [ ] **Step 1: Каркас**

`package.json`:
```json
{
  "name": "fetch-sitecollection2md",
  "version": "0.1.0",
  "private": true,
  "description": "Fetch a collection from a website into a Markdown file",
  "type": "module",
  "engines": { "node": ">=20.18.1" },
  "scripts": { "test": "node --test" }
}
```

`.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Написать падающий тест**

`test/records.test.js`:
```js
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
```

- [ ] **Step 3: Запустить — падает**

Run: `node --test test/records.test.js`
Expected: FAIL — `Cannot find module '…/lib/records.js'`.

- [ ] **Step 4: Реализация**

`lib/records.js`:
```js
const str = v => (typeof v === 'string' ? v.trim() : '');

export function normalize(records, source) {
  if (!Array.isArray(records)) throw new Error(`${source}: adapter must return an array`);
  const seen = new Set();
  const out = [];
  let skipped = 0;
  let duplicates = 0;
  for (const r of records) {
    const title = str(r?.title);
    const url = str(r?.url);
    if (!title || !url) { skipped++; continue; }
    if (seen.has(url)) { duplicates++; continue; }
    seen.add(url);
    out.push({
      title,
      url,
      source,
      description: str(r.description),
      tags: (r.tags ?? []).map(str).filter(Boolean),
      signal: str(r.signal) || null,
      extra: Object.fromEntries(Object.entries(r.extra ?? {}).filter(([, v]) => v != null && v !== '')),
    });
  }
  if (out.length === 0) throw new Error(`${source}: no valid records (got ${records.length}, skipped ${skipped})`);
  return { records: out, skipped, duplicates };
}
```

- [ ] **Step 5: Запустить — проходит**

Run: `node --test test/records.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit** (только с разрешения)

```bash
git add package.json .gitignore lib/records.js test/records.test.js
git commit -m "feat: project skeleton and record normalization"
```

---

### Task 2: HTTP-клиент

**Files:**
- Create: `lib/http.js`
- Test: `test/http.test.js`

**Interfaces:**
- Produces: `createGet(opts?) → get(url: string, init?: RequestInit) → Promise<Response>`.
  `opts = { delayMs=1000, timeoutMs=30000, attempts=3, backoffMs=1000, maxRetryAfterMs=60000, userAgent='fetch-sitecollection2md/0.1', sleep }`.
  `retryAfterMs(value: string|null, max: number, now?: number) → number|null`.

- [ ] **Step 1: Написать падающий тест**

`test/http.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createGet, retryAfterMs } from '../lib/http.js';

async function serve(handler) {
  let hits = 0;
  const server = createServer((req, res) => handler(req, res, ++hits));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return { url, hits: () => hits, close: () => { server.closeAllConnections(); return new Promise(r => server.close(r)); } };
}

function fastGet(opts = {}) {
  const sleeps = [];
  const get = createGet({ delayMs: 0, backoffMs: 5, sleep: ms => { sleeps.push(ms); return Promise.resolve(); }, ...opts });
  return { get, sleeps };
}

test('200 returns Response and sends User-Agent', async () => {
  let ua;
  const s = await serve((req, res) => { ua = req.headers['user-agent']; res.end('ok'); });
  try {
    const { get } = fastGet();
    assert.equal(await (await get(s.url)).text(), 'ok');
    assert.equal(ua, 'fetch-sitecollection2md/0.1');
  } finally { await s.close(); }
});

test('404 throws at once with url and status', async () => {
  const s = await serve((req, res) => { res.statusCode = 404; res.end(); });
  try {
    const { get } = fastGet();
    await assert.rejects(get(s.url), new RegExp(`GET ${s.url} -> 404`));
    assert.equal(s.hits(), 1);
  } finally { await s.close(); }
});

test('5xx then success is retried', async () => {
  const s = await serve((req, res, n) => { res.statusCode = n === 1 ? 502 : 200; res.end('ok'); });
  try {
    const { get } = fastGet();
    assert.equal((await get(s.url)).status, 200);
    assert.equal(s.hits(), 2);
  } finally { await s.close(); }
});

test('exhausted attempts throw with last reason', async () => {
  const s = await serve((req, res) => { res.statusCode = 503; res.end(); });
  try {
    const { get } = fastGet();
    await assert.rejects(get(s.url), /failed after 3 attempts: status 503/);
    assert.equal(s.hits(), 3);
  } finally { await s.close(); }
});

test('429 honours Retry-After seconds', async () => {
  const s = await serve((req, res, n) => {
    if (n === 1) { res.statusCode = 429; res.setHeader('retry-after', '2'); }
    res.end('ok');
  });
  try {
    const { get, sleeps } = fastGet();
    assert.equal((await get(s.url)).status, 200);
    assert.deepEqual(sleeps, [2000]);
  } finally { await s.close(); }
});

test('429 honours Retry-After HTTP date', async () => {
  const s = await serve((req, res, n) => {
    if (n === 1) { res.statusCode = 429; res.setHeader('retry-after', new Date(Date.now() + 5000).toUTCString()); }
    res.end('ok');
  });
  try {
    const { get, sleeps } = fastGet();
    await get(s.url);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 3000 && sleeps[0] <= 5000, `slept ${sleeps[0]}`);
  } finally { await s.close(); }
});

test('Retry-After is capped', () => {
  assert.equal(retryAfterMs('3600', 60000), 60000);
  assert.equal(retryAfterMs('garbage', 60000), null);
  assert.equal(retryAfterMs(null, 60000), null);
});

test('network error is retried and reported', async () => {
  const s = await serve((req, res) => res.end());
  const url = s.url;
  await s.close();
  const { get } = fastGet();
  await assert.rejects(get(url), /failed after 3 attempts: ECONNREFUSED/);
});

test('attempt timeout is retried', async () => {
  const s = await serve((req, res, n) => { if (n > 1) res.end('ok'); });
  try {
    const { get } = fastGet({ timeoutMs: 100 });
    assert.equal(await (await get(s.url)).text(), 'ok');
    assert.equal(s.hits(), 2);
  } finally { await s.close(); }
});

test('paces requests by delayMs', async () => {
  const s = await serve((req, res) => res.end('ok'));
  try {
    const { get, sleeps } = fastGet({ delayMs: 1000 });
    await get(s.url);
    await get(s.url);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 500 && sleeps[0] <= 1000, `slept ${sleeps[0]}`);
  } finally { await s.close(); }
});
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test test/http.test.js`
Expected: FAIL — `Cannot find module '…/lib/http.js'`.

- [ ] **Step 3: Реализация**

`lib/http.js`:
```js
const retryable = status => status === 429 || status >= 500;
const realSleep = ms => new Promise(r => setTimeout(r, ms));

export function retryAfterMs(value, max, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), max);
}

export function createGet({
  delayMs = 1000, timeoutMs = 30000, attempts = 3, backoffMs = 1000, maxRetryAfterMs = 60000,
  userAgent = 'fetch-sitecollection2md/0.1', sleep = realSleep,
} = {}) {
  let last = -Infinity;
  async function pace() {
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  }
  return async function get(url, init = {}) {
    let reason;
    for (let i = 1; i <= attempts; i++) {
      await pace();
      let res;
      try {
        res = await fetch(url, { ...init, headers: { 'user-agent': userAgent, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        reason = e.name === 'TimeoutError' ? `timeout ${timeoutMs}ms` : (e.cause?.code ?? e.message);
        if (i < attempts) await sleep(backoffMs * i);
        continue;
      }
      if (res.ok) return res;
      if (!retryable(res.status)) throw new Error(`GET ${url} -> ${res.status}`);
      reason = `status ${res.status}`;
      await res.body?.cancel();
      if (i < attempts) await sleep(retryAfterMs(res.headers.get('retry-after'), maxRetryAfterMs) ?? backoffMs * i);
    }
    throw new Error(`GET ${url} failed after ${attempts} attempts: ${reason}`);
  };
}
```

- [ ] **Step 4: Запустить — проходит**

Run: `node --test test/http.test.js`
Expected: PASS, 10 tests. Если `network error` падает из-за текста причины (например, на Windows `e.cause.code` иной), вывести фактическое `e.cause` и исправить извлечение причины в `lib/http.js`, не ожидание теста.

- [ ] **Step 5: Commit** (только с разрешения)

```bash
git add lib/http.js test/http.test.js
git commit -m "feat: http client with pacing, timeout and retries"
```

---

### Task 3: Рендер, запись снимка, пути

**Files:**
- Create: `lib/render.js`, `lib/snapshot.js`, `lib/paths.js`
- Test: `test/render.test.js`, `test/snapshot.test.js`, `test/paths.test.js`

**Interfaces:**
- Consumes: `Record` из Task 1.
- Produces:
  - `renderMd({ collection, url, date, notes: string[], records: Record[] }) → string`
  - `renderJsonl(records: Record[]) → string`
  - `writeSnapshot(dir: string, date: string, { md: string, jsonl: string }) → Promise<[jsonlPath, mdPath]>`
  - `REPO_DIR: string`, `defaultRoot(repoDir?: string) → string`, `localDate(d?: Date) → 'YYYY-MM-DD'`

- [ ] **Step 1: Написать падающие тесты**

`test/render.test.js`:
```js
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
```

`test/snapshot.test.js`:
```js
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
```

`test/paths.test.js`:
```js
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
```

- [ ] **Step 2: Запустить — падают**

Run: `node --test test/render.test.js test/snapshot.test.js test/paths.test.js`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализация**

`lib/render.js`:
```js
const oneLine = s => s.replace(/\s+/g, ' ').trim();

export function renderMd({ collection, url, date, notes, records }) {
  const lines = [`# ${collection}`, '', `- source: ${url}`, `- date: ${date}`, `- records: ${records.length}`];
  for (const n of notes) lines.push(`- note: ${oneLine(n)}`);
  for (const r of records) {
    lines.push('', `## ${oneLine(r.title)}`, `- url: ${r.url}`);
    if (r.description) lines.push(`- description: ${oneLine(r.description)}`);
    if (r.tags.length) lines.push(`- tags: ${r.tags.join(', ')}`);
    if (r.signal) lines.push(`- signal: ${r.signal}`);
    if (Object.keys(r.extra).length) lines.push(`- extra: ${JSON.stringify(r.extra)}`);
  }
  return lines.join('\n') + '\n';
}

export const renderJsonl = records => records.map(r => JSON.stringify(r)).join('\n') + '\n';
```

`lib/snapshot.js`:
```js
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
```

`lib/paths.js`:
```js
import { resolve } from 'node:path';

export const REPO_DIR = resolve(import.meta.dirname, '..');

export const defaultRoot = (repoDir = REPO_DIR) =>
  resolve(repoDir, '../../../../data/my/tools/fetch-sitecollection2md');

const pad = n => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
```

- [ ] **Step 4: Запустить — проходят**

Run: `node --test test/render.test.js test/snapshot.test.js test/paths.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit** (только с разрешения)

```bash
git add lib/render.js lib/snapshot.js lib/paths.js test/render.test.js test/snapshot.test.js test/paths.test.js
git commit -m "feat: markdown/jsonl rendering and atomic snapshot write"
```

---

### Task 4: `run()`, CLI, инструменты фикстур

**Files:**
- Create: `lib/run.js`, `fetch.js`, `test/helpers/fixture-ctx.js`, `scripts/capture.js`
- Test: `test/run.test.js`, `test/cli.test.js`

**Interfaces:**
- Consumes: `normalize` (Task 1), `createGet` (Task 2), `renderMd`/`renderJsonl`/`writeSnapshot`/`REPO_DIR`/`defaultRoot`/`localDate` (Task 3).
- Produces:
  - `run({ collection, adapter, outRoot, get, date, log? }) → Promise<{ records, skipped, duplicates, files }>`;
    `ctx = { get, note(text) }` передаётся в `adapter.fetch(ctx)`.
  - `fixtureCtx(dir) → Promise<{ get(url) → Response, note(text), requested: string[], notes: string[] }>` —
    `dir/index.json` = `{ "<url>": "<file>" }`; незнакомый URL → `Error('no fixture for <url>')`.
  - `node scripts/capture.js <collection> [<url>…]` — с URL: скачивает их; без URL: прогоняет `adapters/<collection>.js`
    с записывающим `get` (пауза 1 с). Пишет `test/fixtures/<collection>/NNN.txt` и `index.json` (перезаписывает каталог).

- [ ] **Step 1: Написать падающие тесты**

`test/run.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../lib/run.js';

const adapter = records => ({ url: 'https://c', async fetch(ctx) { ctx.note('slice note'); return records; } });

test('writes snapshot with notes in md only and reports counts', async () => {
  const outRoot = await mkdtemp(join(tmpdir(), 'run-'));
  const logs = [];
  const r = await run({
    collection: 'c', outRoot, date: '2026-09-25', get: null, log: m => logs.push(m),
    adapter: adapter([{ title: 'A', url: 'https://a' }, { title: 'A2', url: 'https://a' }, { title: '' }]),
  });
  assert.deepEqual([r.records.length, r.skipped, r.duplicates], [1, 1, 1]);
  const md = await readFile(join(outRoot, 'c', '2026-09-25.md'), 'utf8');
  const jsonl = await readFile(join(outRoot, 'c', '2026-09-25.jsonl'), 'utf8');
  assert.match(md, /^- note: slice note$/m);
  assert.doesNotMatch(jsonl, /slice note/);
  assert.equal(JSON.parse(jsonl.trim()).source, 'c');
  assert.ok(logs.some(l => /skipped 1 invalid/.test(l)));
  assert.ok(logs.some(l => /c: 1 records, 1 skipped, 1 duplicates/.test(l)));
});

test('adapter error writes nothing', async () => {
  const outRoot = await mkdtemp(join(tmpdir(), 'run-'));
  const bad = { url: 'u', async fetch() { throw new Error('boom'); } };
  await assert.rejects(run({ collection: 'c', outRoot, date: 'd', get: null, adapter: bad, log() {} }), /boom/);
  assert.deepEqual(await readdir(outRoot), []);
});

test('zero valid records writes nothing', async () => {
  const outRoot = await mkdtemp(join(tmpdir(), 'run-'));
  await assert.rejects(run({ collection: 'c', outRoot, date: 'd', get: null, adapter: adapter([{ title: 'x' }]), log() {} }), /no valid records/);
  assert.deepEqual(await readdir(outRoot), []);
});
```

`test/cli.test.js`:
```js
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
```

- [ ] **Step 2: Запустить — падают**

Run: `node --test test/run.test.js test/cli.test.js`
Expected: FAIL — `lib/run.js` не найден; CLI — `Cannot find module …fetch.js` (status 1, не 2).

- [ ] **Step 3: Реализация**

`lib/run.js`:
```js
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
```

`fetch.js`:
```js
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
```

`test/helpers/fixture-ctx.js`:
```js
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
```

`scripts/capture.js`:
```js
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
```

- [ ] **Step 4: Запустить — проходят**

Run: `npm test`
Expected: PASS, все тесты Task 1–4 (records 6, http 10, render 3, snapshot 3, paths 3, run 3, cli 6).

- [ ] **Step 5: Commit** (только с разрешения)

```bash
git add lib/run.js fetch.js test/helpers/fixture-ctx.js scripts/capture.js test/run.test.js test/cli.test.js
git commit -m "feat: run orchestration, CLI and fixture tooling"
```

---

### Task 5: Адаптер n8n

**Files:**
- Create: `adapters/n8n.js`, `test/fixtures/n8n/*`
- Test: `test/n8n.test.js`

**Interfaces:**
- Consumes: `ctx` (Task 4), `fixtureCtx`, `scripts/capture.js`.
- Produces: `default { url, fetch(ctx) }` (top-1000, rows 250); `fetchTop(ctx, { limit, rows }) → raw records`;
  `trimDescription(text, max = 500) → string`.

Факты (проверено 2026-09-25): `GET https://api.n8n.io/templates/search?page=N&rows=R&sort=views:desc`, страницы с 1,
`rows` ≤ 250; ответ `{ totalWorkflows, workflows: [{ id, name, totalViews, price, user: { username }, description, createdAt, nodes: [{ displayName }] }], filters }`.
Сейчас топ-1: id 1954 «AI agent chat», автор `n8n-team`, ноды включают «AI Agent».

- [ ] **Step 1: Снять фикстуры** (реальные, малый `rows`)

Run:
```bash
node scripts/capture.js n8n \
  "https://api.n8n.io/templates/search?page=1&rows=2&sort=views:desc" \
  "https://api.n8n.io/templates/search?page=2&rows=2&sort=views:desc" \
  "https://api.n8n.io/templates/search?page=3&rows=2&sort=views:desc"
```
Expected: `3 fixtures -> …/test/fixtures/n8n`. Проверить `id` первой записи `001.txt`: если топ-1 уже не 1954, заменить в тесте id/name/author/ноду на фактические значения первой записи.

- [ ] **Step 2: Написать падающий тест**

`test/n8n.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import adapter, { fetchTop, trimDescription } from '../adapters/n8n.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const API = 'https://api.n8n.io/templates/search';
const fixtures = join(import.meta.dirname, 'fixtures', 'n8n');

test('trimDescription collapses whitespace and cuts with ellipsis within limit', () => {
  assert.equal(trimDescription('  a\n\n b\tc '), 'a b c');
  const long = trimDescription('x'.repeat(600));
  assert.equal(long.length, 500);
  assert.ok(long.endsWith('…'));
  assert.equal(trimDescription(undefined), '');
});

test('fetchTop pages until limit and maps records', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await fetchTop(ctx, { limit: 5, rows: 2 });
  assert.deepEqual(ctx.requested, [1, 2, 3].map(p => `${API}?page=${p}&rows=2&sort=views:desc`));
  assert.equal(records.length, 5);
  const [top] = records;
  assert.equal(top.url, 'https://n8n.io/workflows/1954');
  assert.equal(top.title, 'AI agent chat');
  assert.equal(top.extra.author, 'n8n-team');
  assert.ok(top.extra.nodes.includes('AI Agent'));
  assert.equal(top.extra.price, 0);
  for (const r of records) {
    assert.match(r.signal, /^\d+ views$/);
    assert.ok(r.description.length <= 500 && !/\n/.test(r.description));
  }
  assert.equal(ctx.notes.length, 1);
  assert.match(ctx.notes[0], /^top 5 of \d+ templates by views \(desc\)$/);
});

const memCtx = pages => ({
  note() {},
  async get(url) {
    const page = Number(new URL(url).searchParams.get('page'));
    return Response.json(pages[page - 1]);
  },
});
const wf = id => ({ id, name: `w${id}`, totalViews: 1, nodes: [] });

test('empty page before expected count is an error', async () => {
  const ctx = memCtx([{ totalWorkflows: 100, workflows: [wf(1), wf(2)] }, { totalWorkflows: 100, workflows: [] }]);
  await assert.rejects(fetchTop(ctx, { limit: 5, rows: 2 }), /n8n: page 2 empty after 2 of 5 expected/);
});

test('short page before expected count is an error', async () => {
  const ctx = memCtx([{ totalWorkflows: 100, workflows: [wf(1)] }]);
  await assert.rejects(fetchTop(ctx, { limit: 5, rows: 2 }), /n8n: page 1 short \(1 of 2\) after 1 of 5 expected/);
});

test('catalog smaller than limit takes all', async () => {
  const ctx = memCtx([{ totalWorkflows: 3, workflows: [wf(1), wf(2)] }, { totalWorkflows: 3, workflows: [wf(3)] }]);
  assert.equal((await fetchTop(ctx, { limit: 5, rows: 2 })).length, 3);
});

test('API error payload is reported', async () => {
  const ctx = memCtx([{ data: null, error: { status: 400, message: 'Parameter `sort_by` is malformed.' } }]);
  await assert.rejects(fetchTop(ctx, { limit: 5, rows: 2 }), /n8n: unexpected response on page 1: .*sort_by/);
});

test('default export targets top 1000 by views', () => {
  assert.equal(adapter.url, 'https://n8n.io/workflows/');
});
```

- [ ] **Step 3: Запустить — падает**

Run: `node --test test/n8n.test.js`
Expected: FAIL — `Cannot find module '…/adapters/n8n.js'`.

- [ ] **Step 4: Реализация**

`adapters/n8n.js`:
```js
const API = 'https://api.n8n.io/templates/search';
const LIMIT = 1000;
const ROWS = 250;

export function trimDescription(text, max = 500) {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

const toRecord = w => ({
  title: w.name,
  url: `https://n8n.io/workflows/${w.id}`,
  description: trimDescription(w.description),
  signal: w.totalViews == null ? null : `${w.totalViews} views`,
  extra: {
    price: w.price,
    createdAt: w.createdAt,
    author: w.user?.username,
    nodes: [...new Set((w.nodes ?? []).map(n => n.displayName).filter(Boolean))],
  },
});

export async function fetchTop(ctx, { limit = LIMIT, rows = ROWS } = {}) {
  const out = [];
  let total = Infinity;
  for (let page = 1; out.length < Math.min(limit, total); page++) {
    const data = await (await ctx.get(`${API}?page=${page}&rows=${rows}&sort=views:desc`)).json();
    if (!Array.isArray(data?.workflows) || typeof data.totalWorkflows !== 'number') {
      throw new Error(`n8n: unexpected response on page ${page}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    total = data.totalWorkflows;
    const expected = Math.min(limit, total);
    if (data.workflows.length === 0) throw new Error(`n8n: page ${page} empty after ${out.length} of ${expected} expected`);
    out.push(...data.workflows.slice(0, expected - out.length));
    if (out.length < expected && data.workflows.length < rows) {
      throw new Error(`n8n: page ${page} short (${data.workflows.length} of ${rows}) after ${out.length} of ${expected} expected`);
    }
  }
  ctx.note(`top ${out.length} of ${total} templates by views (desc)`);
  return out.map(toRecord);
}

export default {
  url: 'https://n8n.io/workflows/',
  fetch: ctx => fetchTop(ctx),
};
```

- [ ] **Step 5: Запустить — проходит**

Run: `node --test test/n8n.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit** (только с разрешения)

```bash
git add adapters/n8n.js test/n8n.test.js test/fixtures/n8n
git commit -m "feat: n8n adapter (top templates by views)"
```

---

### Task 6: Адаптер awesomejev (+ cheerio)

**Files:**
- Modify: `package.json` (dependency), create `package-lock.json` (npm)
- Create: `adapters/awesomejev.js`, `test/fixtures/awesomejev/*`
- Test: `test/awesomejev.test.js`

**Interfaces:**
- Consumes: `ctx`, `fixtureCtx`, `scripts/capture.js`.
- Produces: `default { url: 'https://awesomejev.com/', fetch(ctx) }`.

Факты (проверено): одна страница; разделы `section.cat`, заголовок — первый `span` в `.win-bar`
(«04 · Agent tooling»); запись `tr[data-name]`: `td.c-name > a` (title/href), `span.owner`, `td.c-desc`,
`td.c-lang`, `td.c-stars` («★ 20» или `—`), `data-stars`, `data-added`, ссылки `a[title="GitHub repository"]`, `a[title="Website"]`.
Пример: agent-chaperone → `https://github.com/agent-chaperone/agent-chaperone`, раздел «Agent tooling», TypeScript, site `https://agentchaperone.dev`.

- [ ] **Step 1: Зависимость и фикстура**

Run:
```bash
npm install cheerio@^1.2.0
node scripts/capture.js awesomejev https://awesomejev.com/
```
Expected: `package.json` получил `"dependencies": { "cheerio": "^1.2.0" }`, создан `package-lock.json`;
`1 fixtures -> …/test/fixtures/awesomejev`. Проверить, что в `001.txt` есть `agent-chaperone`
(`grep -c agent-chaperone test/fixtures/awesomejev/001.txt` > 0); иначе выбрать в тесте другую запись из фикстуры.

- [ ] **Step 2: Написать падающий тест**

`test/awesomejev.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import adapter from '../adapters/awesomejev.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'awesomejev');

test('parses every table row with section, language, stars, links', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await adapter.fetch(ctx);
  const html = await readFile(join(fixtures, '001.txt'), 'utf8');
  assert.deepEqual(ctx.requested, ['https://awesomejev.com/']);
  assert.equal(records.length, html.split('<tr data-name=').length - 1);
  assert.equal(new Set(records.map(r => r.tags[0])).size, html.split('<section class="cat').length - 1);

  const r = records.find(x => x.title === 'agent-chaperone');
  assert.equal(r.url, 'https://github.com/agent-chaperone/agent-chaperone');
  assert.deepEqual(r.tags, ['Agent tooling', 'TypeScript']);
  assert.match(r.signal, /^\d+ stars$/);
  assert.equal(r.extra.owner, 'agent-chaperone');
  assert.equal(r.extra.repo, 'https://github.com/agent-chaperone/agent-chaperone');
  assert.equal(r.extra.site, 'https://agentchaperone.dev');
  assert.match(r.extra.added, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.description, /^Screens an AI agent's tool calls/);
});

test('rows without GitHub stars have null signal', async () => {
  const records = await adapter.fetch(await fixtureCtx(fixtures));
  assert.ok(records.some(r => r.signal === null));
  assert.ok(records.every(r => r.signal === null || /^\d+ stars$/.test(r.signal)));
  assert.ok(records.every(r => !r.tags.includes('—')));
});
```

- [ ] **Step 3: Запустить — падает**

Run: `node --test test/awesomejev.test.js`
Expected: FAIL — `Cannot find module '…/adapters/awesomejev.js'`.

- [ ] **Step 4: Реализация**

`adapters/awesomejev.js`:
```js
import * as cheerio from 'cheerio';

const URL_ = 'https://awesomejev.com/';
const text = el => el.text().replace(/\s+/g, ' ').trim();

export default {
  url: URL_,
  async fetch(ctx) {
    const $ = cheerio.load(await (await ctx.get(URL_)).text());
    const out = [];
    $('section.cat').each((_, sec) => {
      const section = text($(sec).find('.win-bar span').first()).replace(/^\d+\s*·\s*/, '');
      $(sec).find('tr[data-name]').each((_, tr) => {
        const row = $(tr);
        const link = row.find('td.c-name > a').first();
        const lang = text(row.find('td.c-lang'));
        const hasStars = row.find('td.c-stars').text().includes('★');
        out.push({
          title: text(link),
          url: link.attr('href'),
          description: text(row.find('td.c-desc')),
          tags: [section, lang === '—' ? '' : lang],
          signal: hasStars ? `${Number(row.attr('data-stars'))} stars` : null,
          extra: {
            owner: text(row.find('span.owner')),
            repo: row.find('a[title="GitHub repository"]').attr('href'),
            site: row.find('a[title="Website"]').attr('href'),
            added: row.attr('data-added'),
          },
        });
      });
    });
    return out;
  },
};
```

Примечание: `link.text()` включает только текст `<a>`; `span.owner` — соседний элемент, в title не попадает.

- [ ] **Step 5: Запустить — проходит**

Run: `node --test test/awesomejev.test.js`
Expected: PASS, 2 tests. Пустой тег `''` отфильтрует `normalize`; в тесте адаптера `tags` может содержать `''` для строк без языка — поэтому проверяется только отсутствие `—`.

- [ ] **Step 6: Commit** (только с разрешения)

```bash
git add package.json package-lock.json adapters/awesomejev.js test/awesomejev.test.js test/fixtures/awesomejev
git commit -m "feat: awesomejev adapter"
```

---

### Task 7: Адаптер replit

**Files:**
- Create: `adapters/replit.js`, `test/fixtures/replit/*`
- Test: `test/replit.test.js`

**Interfaces:**
- Consumes: `ctx`, `fixtureCtx`, `scripts/capture.js` (режим записи прогона адаптера).
- Produces: `default { url: 'https://replit.com/gallery', fetch(ctx) }`; `galleryPages(html) → object[]`.

Факты (проверено): `script#__NEXT_DATA__` с JSON; записи — объекты `_type: "galleryPage"` (`slug`, `title`, `deck`,
`viewCount`, `remixCount`, `creatorName`, `categoryTags[{ slug, title, parentUseCaseTags[{ slug }] }]`, `typeTags[{ title }]`).
`/gallery` — 82 уникальные записи; `https://replit.com/marketing-sitemap/sitemap.xml` — 95 уникальных slug в
`/gallery/<group>/<category>/<slug>`; страница записи содержит её объект. Пример: `sf-park-mapper` → «SF Park Mapper»,
deck «Discover San Francisco parks and outdoor activities», `Matt Palmer`, URL `/gallery/life/entertainment/sf-park-mapper`.
Фикстуры ≈ 4.5 MB (галерея 1.5 MB + sitemap + ~13 страниц по ~210 KB).

- [ ] **Step 1: Написать падающий тест**

`test/replit.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import adapter, { galleryPages } from '../adapters/replit.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'replit');

test('galleryPages finds nested galleryPage objects', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ a: [{ b: { _type: 'galleryPage', slug: 's' } }] })}</script>`;
  assert.deepEqual(galleryPages(html).map(p => p.slug), ['s']);
  assert.throws(() => galleryPages('<html></html>'), /__NEXT_DATA__ not found/);
});

test('collects gallery plus sitemap-only entries without duplicates', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await adapter.fetch(ctx);
  assert.deepEqual(ctx.requested.slice(0, 2), ['https://replit.com/gallery', 'https://replit.com/marketing-sitemap/sitemap.xml']);
  assert.equal(new Set(records.map(r => r.url)).size, records.length);

  const index = JSON.parse(await readFile(join(fixtures, 'index.json'), 'utf8'));
  const sitemap = await readFile(join(fixtures, index['https://replit.com/marketing-sitemap/sitemap.xml']), 'utf8');
  const slugs = new Set([...sitemap.matchAll(/\/gallery\/[^/<]+\/[^/<]+\/([^/<]+)<\/loc>/g)].map(m => m[1]));
  const got = new Set(records.map(r => r.url.split('/').pop()));
  assert.deepEqual([...slugs].filter(s => !got.has(s)), []);
  assert.deepEqual(ctx.notes, []);

  const r = records.find(x => x.url === 'https://replit.com/gallery/life/entertainment/sf-park-mapper');
  assert.equal(r.title, 'SF Park Mapper');
  assert.equal(r.description, 'Discover San Francisco parks and outdoor activities');
  assert.ok(r.tags.includes('Entertainment'));
  assert.match(r.signal, /^\d+ views$/);
  assert.equal(r.extra.creator, 'Matt Palmer');
  assert.equal(typeof r.extra.remixCount, 'number');
  assert.ok(r.extra.types.includes('App'));
});
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test test/replit.test.js`
Expected: FAIL — `Cannot find module '…/adapters/replit.js'`.

- [ ] **Step 3: Реализация**

`adapters/replit.js`:
```js
const BASE = 'https://replit.com';
const SITEMAP = `${BASE}/marketing-sitemap/sitemap.xml`;

export function galleryPages(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('replit: __NEXT_DATA__ not found');
  const found = [];
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if (o._type === 'galleryPage') found.push(o);
      Object.values(o).forEach(walk);
    }
  })(JSON.parse(m[1]));
  return found;
}

const toRecord = p => {
  const cat = p.categoryTags?.[0];
  const group = cat?.parentUseCaseTags?.[0]?.slug;
  return {
    title: p.title,
    url: cat?.slug && group ? `${BASE}/gallery/${group}/${cat.slug}/${p.slug}` : null,
    description: p.deck,
    tags: (p.categoryTags ?? []).map(t => t.title),
    signal: p.viewCount == null ? null : `${p.viewCount} views`,
    extra: { remixCount: p.remixCount, creator: p.creatorName, types: (p.typeTags ?? []).map(t => t.title) },
  };
};

export default {
  url: `${BASE}/gallery`,
  async fetch(ctx) {
    const bySlug = new Map();
    const add = pages => { for (const p of pages) if (p.slug && !bySlug.has(p.slug)) bySlug.set(p.slug, p); };
    add(galleryPages(await (await ctx.get(`${BASE}/gallery`)).text()));
    const xml = await (await ctx.get(SITEMAP)).text();
    const paths = new Map();
    for (const [, path, slug] of xml.matchAll(/<loc>https:\/\/replit\.com(\/gallery\/[^/<]+\/[^/<]+\/([^/<]+))<\/loc>/g)) {
      if (!paths.has(slug)) paths.set(slug, path);
    }
    for (const [slug, path] of paths) {
      if (bySlug.has(slug)) continue;
      add(galleryPages(await (await ctx.get(BASE + path)).text()));
      if (!bySlug.has(slug)) ctx.note(`sitemap entry without gallery data: ${BASE + path}`);
    }
    return [...bySlug.values()].map(toRecord);
  },
};
```

- [ ] **Step 4: Снять фикстуры записью прогона адаптера**

Run: `node scripts/capture.js replit`
Expected: `N fixtures -> …/test/fixtures/replit`, N ≈ 15 (галерея, sitemap, страницы sitemap-only записей), ~15 с.
Проверить: `du -sh test/fixtures/replit` ≈ 4–5 MB.

- [ ] **Step 5: Запустить — проходит**

Run: `node --test test/replit.test.js`
Expected: PASS, 2 tests. Если sitemap-slug не нашёлся на своей странице (адаптер пишет `ctx.note`, тест падает на `notes`) — это находка о данных источника: показать её пользователю, не ослаблять тест молча.

- [ ] **Step 6: Commit** (только с разрешения)

```bash
git add adapters/replit.js test/replit.test.js test/fixtures/replit
git commit -m "feat: replit gallery adapter"
```

---

### Task 8: Адаптер madewithlaya

**Files:**
- Create: `adapters/madewithlaya.js`, `test/fixtures/madewithlaya/*`
- Test: `test/madewithlaya.test.js`

**Interfaces:**
- Consumes: `ctx`, `fixtureCtx`, `scripts/capture.js`, `cheerio` (Task 6).
- Produces: `default { url: 'https://www.madewithlaya.com/', fetch(ctx) }`.

Факты (проверено): `/` (40), `/page/2` (40), `/page/3` (35; ссылки на `/page/4` нет, `/page/4` → 404). Карточка —
`article`: `h3 a` (title, `href="/builds/<slug>"`), `p.truncate.font-medium` (автор), `a[aria-label="Open the source"]`,
`p.mt-3` (описание), плашка `◫ <span class="shrink-0">GitHub</span> · <span class="truncate">Documents &amp; data</span>`,
счётчик upvotes в SSR — 0 у всех. Пример: `/builds/agentic-graphrag-10k-laya-shadow` — «Agentic GraphRAG over S&P 10-Ks
with Laya as a shadow decision engine beside Jev», автор «Anthony ALCARAZ», source
`https://github.com/AnthonyAlcaraz/aiven-agentic-graphrag-demo`, категория «Documents & data».

- [ ] **Step 1: Написать падающий тест**

`test/madewithlaya.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import adapter from '../adapters/madewithlaya.js';
import { fixtureCtx } from './helpers/fixture-ctx.js';

const BASE = 'https://www.madewithlaya.com';
const fixtures = join(import.meta.dirname, 'fixtures', 'madewithlaya');

test('walks pages until there is no next link and parses cards', async () => {
  const ctx = await fixtureCtx(fixtures);
  const records = await adapter.fetch(ctx);
  assert.deepEqual(ctx.requested, [`${BASE}/`, `${BASE}/page/2`, `${BASE}/page/3`]);

  const index = JSON.parse(await readFile(join(fixtures, 'index.json'), 'utf8'));
  let cards = 0;
  for (const file of Object.values(index)) cards += (await readFile(join(fixtures, file), 'utf8')).split('<article').length - 1;
  assert.equal(records.length, cards);

  const r = records.find(x => x.url === `${BASE}/builds/agentic-graphrag-10k-laya-shadow`);
  assert.equal(r.title, 'Agentic GraphRAG over S&P 10-Ks with Laya as a shadow decision engine beside Jev');
  assert.deepEqual(r.tags, ['Documents & data']);
  assert.equal(r.extra.author, 'Anthony ALCARAZ');
  assert.equal(r.extra.sourceUrl, 'https://github.com/AnthonyAlcaraz/aiven-agentic-graphrag-demo');
  assert.equal(r.extra.kind, 'GitHub');
  assert.match(r.description, /^Anthony Alcaraz's talk demo/);
  assert.ok(records.every(x => x.signal === null));
  assert.deepEqual(ctx.notes, ['upvotes not available (SSR renders 0)']);
});
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test test/madewithlaya.test.js`
Expected: FAIL — `Cannot find module '…/adapters/madewithlaya.js'`.

- [ ] **Step 3: Реализация**

`adapters/madewithlaya.js`:
```js
import * as cheerio from 'cheerio';

const BASE = 'https://www.madewithlaya.com';
const MAX_PAGES = 100;
const text = el => el.text().replace(/\s+/g, ' ').trim();

export default {
  url: `${BASE}/`,
  async fetch(ctx) {
    ctx.note('upvotes not available (SSR renders 0)');
    const out = [];
    for (let n = 1, path = '/'; path; n++) {
      if (n > MAX_PAGES) throw new Error(`madewithlaya: more than ${MAX_PAGES} pages`);
      const $ = cheerio.load(await (await ctx.get(BASE + path)).text());
      $('article').each((_, el) => {
        const card = $(el);
        const link = card.find('h3 a').first();
        const href = link.attr('href');
        out.push({
          title: text(link),
          url: href ? BASE + href : null,
          description: text(card.find('p.mt-3').first()),
          tags: [text(card.find('span.truncate').last())],
          signal: null,
          extra: {
            author: text(card.find('p.truncate.font-medium').first()),
            sourceUrl: card.find('a[aria-label="Open the source"]').attr('href'),
            kind: text(card.find('span.shrink-0').first()),
          },
        });
      });
      path = $(`a[href="/page/${n + 1}"]`).length ? `/page/${n + 1}` : null;
    }
    return out;
  },
};
```

- [ ] **Step 4: Снять фикстуры записью прогона адаптера**

Run: `node scripts/capture.js madewithlaya`
Expected: `3 fixtures -> …/test/fixtures/madewithlaya`. Если страниц стало больше — тест выше обновить на фактический список URL (он выводится в `index.json`).

- [ ] **Step 5: Запустить — проходит**

Run: `node --test test/madewithlaya.test.js`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit** (только с разрешения)

```bash
git add adapters/madewithlaya.js test/madewithlaya.test.js test/fixtures/madewithlaya
git commit -m "feat: madewithlaya adapter"
```

---

### Task 9: README, полный прогон тестов, живые снимки

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

`README.md`:
````markdown
# fetch-sitecollection2md
Fetch a collection from a website into a Markdown file

Собирает коллекцию «готовых решений» с сайта в датированный снимок для агентов:
`<root>/<collection>/YYYY-MM-DD.md` и `YYYY-MM-DD.jsonl`. Только fetch, без LLM.
Дизайн — `docs/superpowers/specs/2026-09-25-fetch-sitecollection2md-design.md`.

## Использование

```bash
npm install
node fetch.js <collection> [--out <root>]
```

Коллекции v1: `n8n`, `awesomejev`, `replit`, `madewithlaya`.
Корень по умолчанию — `!all/data/my/tools/fetch-sitecollection2md` (считается от расположения репо;
из git worktree указывать `--out`). Повторный запуск в тот же день заменяет снимок дня.
Код выхода: 0 — успех, 1 — ошибка сбора/записи, 2 — неверные аргументы.

## Новый адаптер

`adapters/<name>.js` (имя — `[a-z0-9-]+`):

```js
export default {
  url: 'https://…',               // URL коллекции для шапки md
  delayMs: 1000,                  // необязательно
  async fetch(ctx) {              // ctx.get(url) → Response; ctx.note(text) → строка в шапке md
    return [{ title, url, description, tags, signal, extra }];
  },
};
```

Ядро проставляет `source`, пропускает записи без `title`/`url`, убирает дубли по `url`.
Фикстуры: `node scripts/capture.js <name> [<url>…]`; тесты — `npm test`.
````

- [ ] **Step 2: Полный прогон тестов**

Run: `npm test`
Expected: код 0, все тесты PASS (records 6, http 10, render 3, snapshot 3, paths 3, run 3, cli 6, n8n 7, awesomejev 2, replit 2, madewithlaya 1).

- [ ] **Step 3: Живые снимки** — из основного checkout репо (не из worktree), иначе с `--out` на абсолютный путь `!all/data/my/tools/fetch-sitecollection2md`.

Run (каждая команда отдельно, код выхода проверяется):
```bash
node fetch.js awesomejev; echo "exit=$?"
node fetch.js madewithlaya; echo "exit=$?"
node fetch.js replit; echo "exit=$?"
node fetch.js n8n; echo "exit=$?"
```
Expected: `exit=0` у всех; stderr — `<c>: N records, …`: awesomejev ≈ 1 094, madewithlaya ≈ 115, replit ≈ 95, n8n = 1000.
Проверить: файлы `C:/Users/T590/!all/data/my/tools/fetch-sitecollection2md/<c>/<today>.{md,jsonl}` существуют,
в `n8n/<today>.md` есть `- note: top 1000 of … templates by views (desc)`, `wc -l` у `.jsonl` равно числу записей.

- [ ] **Step 4: Commit** (только с разрешения)

```bash
git add README.md
git commit -m "docs: usage and adapter contract"
```
