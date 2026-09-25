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
