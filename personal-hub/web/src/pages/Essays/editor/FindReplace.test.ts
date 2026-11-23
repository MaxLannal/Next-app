import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { countMatches, FindReplace, findMatches } from './ext/FindReplace.ts';

/** A headless editor, as the page runs one, over the given plain-text paragraphs. */
function editorWith(...paragraphs: string[]) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [Document, Paragraph, Text, FindReplace],
    content: { type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) },
  });
  const doc = editor.state.doc;
  editor.destroy();
  return doc;
}

const positions = (ranges: { from: number; to: number }[]) => ranges.map((r) => [r.from, r.to]);
const live = (...paragraphs: string[]) =>
  new Editor({
    element: document.createElement('div'),
    extensions: [Document, Paragraph, Text, FindReplace],
    content: { type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) },
  });

describe('findMatches', () => {
  it('finds every occurrence, across paragraphs', () => {
    const doc = editorWith('the cat and the hat', 'the end');
    expect(positions(findMatches(doc, 'the', false))).toEqual([
      [1, 4],
      [13, 16],
      [22, 25],
    ]);
  });

  it('matches case-insensitively unless asked, and not at all for an empty query', () => {
    const doc = editorWith('The the THE');
    expect(findMatches(doc, 'the', false)).toHaveLength(3);
    expect(positions(findMatches(doc, 'the', true))).toEqual([[5, 8]]);
    expect(findMatches(doc, '', false)).toEqual([]);
    expect(findMatches(doc, 'zzz', false)).toEqual([]);
  });

  it('does not overlap matches', () => {
    const doc = editorWith('aaaa');
    expect(positions(findMatches(doc, 'aa', false))).toEqual([
      [1, 3],
      [3, 5],
    ]);
  });
});

describe('the FindReplace commands', () => {
  it('finds and replaces all', () => {
    const editor = live('the cat and the hat');
    expect(editor.commands.setSearch({ query: 'the' })).toBe(true);
    expect(countMatches(editor.state)).toBe(2);
    expect(editor.commands.replaceAll('a')).toBe(true);
    expect(editor.getText()).toBe('a cat and a hat');
    expect(countMatches(editor.state)).toBe(0);
    editor.destroy();
  });

  it('replaces the current match and moves on to the next', () => {
    const editor = live('the cat and the hat');
    editor.commands.setSearch({ query: 'the' });
    expect(editor.commands.replaceCurrent('a')).toBe(true);
    expect(editor.getText()).toBe('a cat and the hat');
    expect(editor.commands.replaceCurrent('one')).toBe(true);
    expect(editor.getText()).toBe('a cat and one hat');
    editor.destroy();
  });

  it('steps to the next match, wrapping to the first', () => {
    const editor = live('the cat and the hat');
    editor.commands.setSearch({ query: 'the' });
    expect(editor.state.selection.from).toBe(1);
    editor.commands.nextMatch();
    expect(editor.state.selection.from).toBe(13);
    editor.commands.nextMatch();
    expect(editor.state.selection.from).toBe(1);
    editor.destroy();
  });
});
