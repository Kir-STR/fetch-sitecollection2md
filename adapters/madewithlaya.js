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
