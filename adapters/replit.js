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
