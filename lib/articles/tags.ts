// lib/articles/tags.ts — P3-3/P3-4 shared bracket-tag parsing.
//
// Same output-contract style as master-studio ([TAG]...[/TAG] blocks parsed
// with a robust regex): the model returns tagged blocks, we extract with a
// tolerant regex, and a missing required tag means "malformed → one retry via
// the runner, then fail cleanly" (never a throw from parsing itself).

/** First occurrence of [tag]...[/tag], trimmed; '' when absent. */
export function xt(raw: string, tag: string): string {
  const m = raw.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  return m ? m[1].trim() : '';
}

/** Every occurrence of [tag]...[/tag], trimmed, empties dropped. */
export function xtAll(raw: string, tag: string): string[] {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

/** `key: value` lines inside a tag body → record (first win per key). */
export function parseKeyLines(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_֐-׿]+)\s*:\s*(.+)$/);
    if (m && !(m[1].trim() in out)) out[m[1].trim()] = m[2].trim();
  }
  return out;
}
