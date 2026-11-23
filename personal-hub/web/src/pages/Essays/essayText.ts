// Plain text for an essay document. TipTap's dialect: `paragraph`, `heading`
// and `listItem` blocks end a line; `hardBreak` is a line break.

type DocNode = { type?: unknown; text?: unknown; content?: unknown };

const BLOCKS = new Set(['paragraph', 'heading', 'listItem']);

/** The document's text, one line per block, no trailing blank lines. */
export function plainTextOf(contentJson: unknown): string {
  const lines: string[] = [];
  let line = '';

  const newLine = () => {
    lines.push(line);
    line = '';
  };
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    const { type, text, content } = node as DocNode;
    if (type === 'text' && typeof text === 'string') line += text;
    else if (type === 'hardBreak') newLine();
    if (Array.isArray(content)) content.forEach(walk);
    if (typeof type === 'string' && BLOCKS.has(type)) newLine();
  };
  walk(contentJson);
  if (line !== '') newLine();

  while (lines.length > 0 && (lines.at(-1) ?? '').trim() === '') lines.pop();
  return lines.join('\n');
}

/** The count of whitespace-separated words. */
export function wordCountOf(plainText: string): number {
  const trimmed = plainText.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
