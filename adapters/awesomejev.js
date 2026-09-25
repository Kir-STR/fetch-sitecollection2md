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
