// The hub's one reading of an essay document, shared by the server and the web app,
// so a save and a restore of the same document give the same first line and count.
//
// The document dialect is TipTap's: `paragraph`, `heading` and `listItem` blocks
// end a line; `hardBreak` is a line break. `bodyOf` puts every line into the search body.

type DocNode = { type?: unknown; text?: unknown; content?: unknown };

const BLOCKS = new Set(['paragraph', 'heading', 'listItem']);

/** The document's text, one line per block, blank lines dropped, no trailing newline. */
export function plainTextOf(contentJson: unknown): string {
  let doc: unknown = contentJson;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      return '';
    }
  }

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
  walk(doc);
  if (line !== '') newLine();

  return lines
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join('\n');
}

/** The first line of text: what a column card shows under the title. */
export function firstLineOf(contentJson: unknown): string {
  return plainTextOf(contentJson).split('\n')[0] ?? '';
}

/** The count of whitespace-separated words; a hyphenated or punctuated run counts once, as it reads. */
export function wordCountOf(contentJson: unknown): number {
  const text = plainTextOf(contentJson).trim();
  return text === '' ? 0 : text.split(/\s+/).length;
}

/** The text a search may match: every line joined by spaces, so a phrase can cross a paragraph break. */
export function bodyOf(contentJson: unknown): string {
  return plainTextOf(contentJson).replace(/\n+/g, ' ');
}
