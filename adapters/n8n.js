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
