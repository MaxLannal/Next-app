import { expect, it } from 'vitest';
import { bodyOf, firstLineOf, plainTextOf, wordCountOf } from './essayText.ts';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const docOf = (...content: unknown[]) => ({ type: 'doc', content });

it('reads one line per block', () => {
  const doc = docOf(
    para('First line'),
    para('Second line'),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A head' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [para('An item')] }] },
    para(''),
  );

  expect(plainTextOf(doc)).toBe('First line\nSecond line\nA head\nAn item');
  expect(firstLineOf(doc)).toBe('First line');
  expect(wordCountOf(doc)).toBe(8);
  expect(bodyOf(doc)).toBe('First line Second line A head An item');
});

it('takes the first line, not the whole text', () => {
  expect(firstLineOf(docOf(para('First line'), para('Then everything else')))).toBe('First line');
  expect(firstLineOf(docOf(para(''), para('  After a blank  ')))).toBe('After a blank');
});

it('treats a hard break as a line break and takes strings or nothing calmly', () => {
  const doc = docOf({
    type: 'paragraph',
    content: [{ type: 'text', text: 'One' }, { type: 'hardBreak' }, { type: 'text', text: 'Two words' }],
  });
  expect(plainTextOf(doc)).toBe('One\nTwo words');
  expect(wordCountOf(doc)).toBe(3);
  expect(firstLineOf(doc)).toBe('One');

  expect(plainTextOf(docOf())).toBe('');
  expect(firstLineOf(docOf())).toBe('');
  expect(wordCountOf(docOf())).toBe(0);
  expect(plainTextOf(JSON.stringify(para('Stored as text')))).toBe('Stored as text');
  expect(plainTextOf('{not json')).toBe('');
  expect(plainTextOf(null)).toBe('');
  expect(wordCountOf(para('One  two\tthree'))).toBe(3);
});
