import type { JSONContent } from '@tiptap/react';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { toDocx } from './exportDocx.ts';

const paragraph = (...text: string[]): JSONContent => ({
  type: 'paragraph',
  content: text.map((t) => ({ type: 'text', text: t })),
});

const doc = (content: JSONContent[]): JSONContent => ({ type: 'doc', content });

async function documentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = zip.file('word/document.xml');
  if (!xml) throw new Error('no word/document.xml');
  return xml.async('string');
}

const table = (...rows: JSONContent[]): JSONContent => ({ type: 'table', content: rows });
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells });
const cell = (type: string, text: string): JSONContent => ({ type, content: [paragraph(text)] });

describe('toDocx', () => {
  it('writes text and a table', async () => {
    const xml = await documentXml(
      await toDocx(
        doc([
          paragraph('Hello'),
          table(
            row(cell('tableHeader', 'Item'), cell('tableHeader', 'Count')),
            row(cell('tableCell', 'Apples'), cell('tableCell', '3')),
          ),
        ]),
        'Notes',
      ),
    );
    expect(xml).toContain('Hello');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Apples');
  });

  it('writes headings, marks, lists and the title', async () => {
    const xml = await documentXml(
      await toDocx(
        doc([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Head', marks: [{ type: 'bold' }] }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('One')] }] },
          { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('Two')] }] },
        ]),
        'My essay',
      ),
    );
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('My essay');
    expect(xml).toContain('One');
    expect(xml).toContain('Two');
    expect(xml).toMatch(/<w:numPr>/);
  });

  it('keeps a list inside a quote, items and numbering intact', async () => {
    const xml = await documentXml(
      await toDocx(
        doc([
          {
            type: 'blockquote',
            content: [
              paragraph('Quoted words'),
              { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('First point')] }] },
            ],
          },
        ]),
        '',
      ),
    );
    expect(xml).toContain('Quoted words');
    expect(xml).toContain('First point');
    expect(xml).toMatch(/<w:numPr>/);
    // The quoted paragraph sits one indent in.
    expect(xml).toMatch(/<w:ind w:left="720"/);
  });

  it('writes a code block in Menlo', async () => {
    const xml = await documentXml(
      await toDocx(doc([{ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] }]), ''),
    );
    expect(xml).toContain('const x = 1;');
    expect(xml).toContain('Menlo');
  });

  it('writes math as its LaTeX source in Cambria Math', async () => {
    const xml = await documentXml(
      await toDocx(doc([paragraph('Euler '), { type: 'inlineMath', attrs: { latex: 'e^{i\\pi}+1=0' } }]), ''),
    );
    expect(xml).toContain('e^{i\\pi}+1=0');
    expect(xml).toContain('Cambria Math');
  });
});
