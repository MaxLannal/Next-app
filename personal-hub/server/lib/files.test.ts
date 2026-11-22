import { describe, expect, it } from 'vitest';
import { classifyFile, isSyncable, mimeFor, safeFilename, servedAs } from './files.ts';

it('classifies by extension', () => {
  expect(classifyFile('IMG_0001.HEIC')).toBe('image');
  expect(classifyFile('hw.py')).toBe('code');
  expect(classifyFile('notes.tex')).toBe('latex');
  expect(classifyFile('data.csv')).toBe('text');
  expect(classifyFile('talk.key')).toBe('other');
  expect(classifyFile('paper.PDF')).toBe('pdf');
  expect(classifyFile('Makefile')).toBe('other');
  expect(classifyFile('.bashrc')).toBe('other');
});

it('syncs code, latex and text only', () => {
  expect((['code', 'latex', 'text'] as const).map((k) => isSyncable(k))).toEqual([true, true, true]);
  expect((['image', 'pdf', 'other'] as const).map((k) => isSyncable(k))).toEqual([false, false, false]);
});

describe('safeFilename', () => {
  it('safe names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('微积分 作业.pdf')).toBe('微积分 作业.pdf');
  });

  it('strips windows path parts and characters outside the allowed set', () => {
    expect(safeFilename('C:\\Users\\max\\hw (2).py')).toBe('hw (2).py');
    expect(safeFilename('a<b>:c?*|"d\n.txt')).toBe('abcd.txt');
    expect(safeFilename('Ch_4-final.v2.tex')).toBe('Ch_4-final.v2.tex');
  });

  it('falls back to file', () => {
    for (const name of ['', '..', '.', '   ', 'dir/', '???']) expect(safeFilename(name)).toBe('file');
  });

  it('composes decomposed accents', () => {
    expect(safeFilename('re\u0301sume\u0301.md')).toBe('résumé.md');
  });

  it('caps long names and keeps the extension', () => {
    const name = safeFilename(`${'a'.repeat(300)}.pdf`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(150);
    expect(name.endsWith('.pdf')).toBe(true);
    const cjk = safeFilename(`${'微'.repeat(100)}.md`);
    expect(Buffer.byteLength(cjk)).toBeLessThanOrEqual(150);
    expect(cjk.endsWith('.md')).toBe(true);
  });
});

describe('mime types', () => {
  it('maps known extensions', () => {
    expect(mimeFor('hw.py')).toBe('text/x-python');
    expect(mimeFor('a.ipynb')).toBe('application/x-ipynb+json');
    expect(mimeFor('notes.tex')).toBe('application/x-tex');
    expect(mimeFor('README.md')).toBe('text/markdown');
    expect(mimeFor('IMG_0001.HEIC')).toBe('image/heic');
    expect(mimeFor('a.png')).toBe('image/png');
    expect(mimeFor('main.rs')).toBe('text/plain');
    expect(mimeFor('talk.key')).toBe('application/octet-stream');
  });

  it('never gives a script-capable type', () => {
    for (const name of ['page.html', 'page.htm', 'logo.svg', 'feed.xml', 'page.xhtml']) {
      expect(mimeFor(name)).toBe('application/octet-stream');
    }
    // A JavaScript type would let a <script> tag on another site run the upload.
    expect(mimeFor('app.js')).toBe('text/plain');
  });

  it('serves only known types inline', () => {
    expect(servedAs('text/x-python')).toEqual({ type: 'text/x-python; charset=utf-8', inline: true });
    expect(servedAs('image/png')).toEqual({ type: 'image/png', inline: true });
    expect(servedAs('text/html')).toEqual({ type: 'application/octet-stream', inline: false });
    expect(servedAs('image/svg+xml')).toEqual({ type: 'application/octet-stream', inline: false });
    expect(servedAs('application/octet-stream')).toEqual({ type: 'application/octet-stream', inline: false });
  });
});
