import { describe, expect, it } from 'vitest';
import { asText, languageOf } from './languages.ts';

describe('languageOf', () => {
  it('maps file extensions to Shiki languages', () => {
    expect(languageOf('hw.py')).toBe('python');
    expect(languageOf('lamport.TEX')).toBe('latex');
    expect(languageOf('data.csv')).toBe('text');
    expect(languageOf('Makefile')).toBe('text');
  });
});

describe('asText', () => {
  it('keeps the bytes of a parsed JSON file as they were written', () => {
    expect(asText('{"a": 1}')).toBe('{"a": 1}');
    // An `.ipynb` arrives parsed (its content type contains "json"); compact JSON is its bytes.
    expect(asText(JSON.parse('{"cells":[]}'))).toBe('{"cells":[]}');
  });
});
