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
