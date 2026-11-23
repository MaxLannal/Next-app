import type { JSONContent } from '@tiptap/react';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from 'docx';

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
const MAX_IMAGE_PX = 600;

const hex = (color: unknown): string | undefined =>
  typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color) ? color.replace('#', '').toUpperCase() : undefined;

/** A CSS size ("18px", "14pt", 18) as half-points; Word sizes runs in half-points. */
const halfPoints = (size: unknown): number | undefined => {
  const n = typeof size === 'number' ? size : typeof size === 'string' ? Number.parseFloat(size) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 2) : undefined;
};

type Mark = { type: string; attrs?: Record<string, unknown> };

const markAttr = (node: JSONContent, type: string) =>
  node.marks?.find((m) => m.type === type)?.attrs as Record<string, unknown> | undefined;
const hasMark = (node: JSONContent, type: string) => node.marks?.some((m: Mark) => m.type === type) ?? false;

/** One text piece with its marks, or a link around it. */
function runOf(node: JSONContent, text: string): TextRun | ExternalHyperlink {
  const style = markAttr(node, 'textStyle');
  const run = new TextRun({
    text,
    bold: hasMark(node, 'bold'),
    italics: hasMark(node, 'italic'),
    strike: hasMark(node, 'strike'),
    underline: hasMark(node, 'underline') ? {} : undefined,
    subScript: hasMark(node, 'subscript'),
    superScript: hasMark(node, 'superscript'),
    color: hex(style?.color),
    highlight: hex(markAttr(node, 'highlight')?.color) as never,
    size: halfPoints(style?.fontSize),
    font: typeof style?.fontFamily === 'string' ? style.fontFamily : undefined,
  });
  const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href;
  return typeof href === 'string' ? new ExternalHyperlink({ link: href, children: [run] }) : run;
}

/** Inline content as runs. Math is its LaTeX source in Cambria Math, italic. */
function inlineOf(children: JSONContent[] | undefined): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const child of children ?? []) {
    if (child.type === 'text') {
      const text = child.text ?? '';
      for (const piece of text.split('\n')) out.push(runOf(child, piece));
    } else if (child.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }));
    } else if (child.type === 'inlineMath' || child.type === 'blockMath') {
      out.push(new TextRun({ text: String(child.attrs?.latex ?? ''), font: 'Cambria Math', italics: true }));
    } else if (Array.isArray(child.content)) {
      out.push(...inlineOf(child.content));
    }
  }
  return out;
}

const spacingOf = (attrs: Record<string, unknown> | undefined): IParagraphOptions['spacing'] => {
  const n = Number(attrs?.lineHeight);
  // Word's auto line is 240 twips; 1.5 lines is 360.
  return Number.isFinite(n) && n > 0 ? { line: Math.round(n * 240), lineRule: 'auto' } : undefined;
};

const indentOf = (attrs: Record<string, unknown> | undefined): IParagraphOptions['indent'] => {
  const n = Number(attrs?.indent);
  return Number.isInteger(n) && n > 0 ? { left: n * 720 } : undefined;
};

const paragraphOf = (node: JSONContent): Paragraph =>
  new Paragraph({
    alignment: ALIGN[node.attrs?.textAlign as keyof typeof ALIGN],
    spacing: spacingOf(node.attrs),
    indent: indentOf(node.attrs),
    children: inlineOf(node.content),
  });

/** A list item's paragraphs, nested items indented a level per list. */
function listItemOf(item: JSONContent, ordered: boolean, level: number, task: boolean): Paragraph[] {
  const out: Paragraph[] = [];
  const numbering = { reference: ordered ? 'numbers' : 'bullets', level, instance: 0 };
  const blocks = item.content ?? [];
  blocks.forEach((child, i) => {
    if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
      const nestedOrdered = child.type === 'orderedList';
      for (const sub of child.content ?? []) out.push(...listItemOf(sub, nestedOrdered, level + 1, child.type === 'taskList'));
      return;
    }
    const runs = inlineOf([child]);
    if (task && i === 0) runs.unshift(new TextRun({ text: item.attrs?.checked === true ? '☑ ' : '☐ ' }));
    out.push(new Paragraph({ numbering, children: runs }));
  });
  if (out.length === 0) out.push(new Paragraph({ numbering, children: [] }));
  return out;
}

function tableOf(node: JSONContent, walk: Walk = {}): Table {
  const rows = (node.content ?? []).map((row) => {
    const cells = (row.content ?? []).map((cell) => {
      const header = cell.type === 'tableHeader';
      const paragraphs: Paragraph[] = [];
      for (const block of cell.content ?? []) {
        if (block.type === 'paragraph') paragraphs.push(quoted(paragraphOf(block), walk.indented === true));
        else paragraphs.push(new Paragraph({ children: inlineOf(block.content) }));
      }
      return new TableCell({
        children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ children: [] })],
        shading: header ? { fill: 'F0EDE6' } : undefined,
        width: { size: 100 / Math.max(1, (row.content ?? []).length), type: WidthType.PERCENTAGE },
      });
    });
    return new TableRow({ children: cells, tableHeader: row.content?.[0]?.type === 'tableHeader' });
  });
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, indent: walk.indented === true ? { size: 720, type: WidthType.DXA } : undefined });
}

/** A paragraph inside a quote sits one indent in: its own indent, or the quote's step. */
const quoted = (p: Paragraph, indented: boolean): Paragraph => {
  if (!indented) return p;
  const own = p.options?.indent as { left?: number; right?: number; hanging?: number } | undefined;
  return new Paragraph({ ...p.options, indent: { left: 720 + (own?.left ?? 0), right: own?.right, hanging: own?.hanging } });
};


type ImageBytes = { bytes: Uint8Array; type: 'png' | 'jpg' | 'gif' };

const cache = new Map<string, Promise<ImageBytes | null>>();

function dataOf(src: string): ImageBytes | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.*)$/i.exec(src);
  if (!match) return null;
  try {
    const binary = atob(match[2]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const mime = match[1]!.toLowerCase();
    return { bytes, type: mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpg' };
  } catch {
    return null;
  }
}

async function loadImage(src: string): Promise<ImageBytes | null> {
  const fromData = dataOf(src);
  if (fromData) return fromData;
  const cached = cache.get(src);
  if (cached) return cached;
  const load = (async (): Promise<ImageBytes | null> => {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        type: type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpg',
      };
    } catch {
      return null;
    }
  })();
  cache.set(src, load);
  return load;
}

async function imageOf(node: JSONContent): Promise<Paragraph | null> {
  const image = await loadImage(String(node.attrs?.src ?? ''));
  if (!image) return null;
  const width = Math.min(MAX_IMAGE_PX, Number(node.attrs?.width) || 480);
  // WebP isn't a format Word reads; the bytes are kept as a JPEG-typed run and Word shows what it can.
  const type = image.type;
  return new Paragraph({
    children: [
      new ImageRun({
        data: image.bytes,
        type: type === 'jpg' ? 'jpg' : type,
        transformation: { width, height: Math.round(width * 0.62) },
      }),
    ],
  });
}

type Walk = { indented?: boolean };

/** A block as Word paragraphs or a table. */
async function blocksOf(node: JSONContent, walk: Walk = {}): Promise<(Paragraph | Table)[]> {
  const children = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return [quoted(paragraphOf(node), walk.indented === true)];
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1);
      const heading = HEADINGS[level - 1];
      return [
        new Paragraph({
          heading,
          alignment: ALIGN[node.attrs?.textAlign as keyof typeof ALIGN],
          indent: walk.indented === true ? { left: 720 } : undefined,
          children: inlineOf(children),
        }),
      ];
    }
    case 'blockquote': {
      // The quote's blocks keep their own shape — a list inside it stays a list, a table a
      // table — with a left indent on each paragraph; a list's numbering keeps its shape.
      const inner: (Paragraph | Table)[] = [];
      for (const child of children) inner.push(...(await blocksOf(child, { indented: true })));
      return inner;
    }
    case 'codeBlock': {
      const lines = (children.find((c) => c.type === 'text')?.text ?? '').split('\n');
      return lines.map(
        (line) =>
          new Paragraph({
            indent: walk.indented === true ? { left: 720 } : undefined,
            children: [new TextRun({ text: line, font: 'Menlo', size: 20 })],
          }),
      );
    }
    case 'bulletList':
      return children.flatMap((item) => listItemOf(item, false, 0, false));
    case 'orderedList':
      return children.flatMap((item) => listItemOf(item, true, 0, false));
    case 'taskList':
      return children.flatMap((item) => listItemOf(item, false, 0, true));
    case 'blockMath':
    case 'inlineMath':
      return [
        new Paragraph({
          indent: walk.indented === true ? { left: 720 } : undefined,
          children: [new TextRun({ text: String(node.attrs?.latex ?? ''), font: 'Cambria Math', italics: true })],
        }),
      ];
    case 'image': {
      const image = await imageOf(node);
      return image ? [image] : [];
    }
    case 'horizontalRule':
      return [
        new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C7C2B8' } },
        }),
      ];
    case 'table':
      return [tableOf(node, walk)];
    default: {
      const out: (Paragraph | Table)[] = [];
      for (const child of children) out.push(...(await blocksOf(child)));
      return out;
    }
  }
}

const listLevel = (reference: 'bullets' | 'numbers') => (level: number) => ({
  level,
  format: reference === 'bullets' ? LevelFormat.BULLET : LevelFormat.DECIMAL,
  text: reference === 'bullets' ? ['•', '◦', '▪', '–'][level % 4]! : `%${level + 1}.`,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
});

/**
 * The essay as a `.docx`: title, headings 1–3, marks, alignment and line spacing,
 * indents, bullet/ordered/task lists, code in Menlo, tables, images (fetched and
 * embedded) and math (its LaTeX source in Cambria Math).
 */
export async function toDocx(doc: JSONContent, title: string): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];
  if (title.trim() !== '') {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title.trim())] }));
  }
  for (const block of doc.content ?? []) children.push(...(await blocksOf(block)));

  return Packer.toBlob(
    new Document({
      creator: 'Hub',
      title: title.trim() === '' ? 'Essay' : title.trim(),
      numbering: {
        config: [
          { reference: 'bullets', levels: [0, 1, 2, 3].map(listLevel('bullets')) },
          { reference: 'numbers', levels: [0, 1, 2, 3].map(listLevel('numbers')) },
        ],
      },
      styles: {
        default: { document: { run: { font: 'Georgia', size: 22 }, paragraph: { spacing: { line: 360 } } } },
      },
      sections: [{ properties: {}, children }],
    }),
  );
}
