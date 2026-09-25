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
