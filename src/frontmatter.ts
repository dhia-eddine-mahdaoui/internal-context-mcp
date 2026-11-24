// Minimal front-matter parser: "key: value" lines, with [a, b] lists.
export function parseFrontMatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    meta[key] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      : value;
  }
  return { meta, body: raw.slice(m[0].length) };
}

export interface Section { heading: string; text: string }

// Split a markdown body into sections at "#"/"##"/"###" headings.
export function splitSections(body: string, fallbackHeading: string): Section[] {
  const sections: Section[] = [];
  let heading = fallbackHeading;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) sections.push({ heading, text });
    buf = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const h = /^(#{1,3})\s+(.*\S)\s*$/.exec(line);
    if (h) { flush(); heading = h[2]; } else buf.push(line);
  }
  flush();
  return sections;
}
