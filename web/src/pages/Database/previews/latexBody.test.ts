import { describe, expect, it } from 'vitest';
import { latexBody } from './AttachmentPreview.tsx';

describe('latexBody', () => {
  it('takes the body out of the hub’s minimal document', () => {
    const file = '\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n\\frac{a}{b}\n\\end{document}\n';
    expect(latexBody(file)).toBe('\\frac{a}{b}');
  });

  it('unwraps one whole math expression, however it is delimited', () => {
    expect(latexBody('$x^2$')).toBe('x^2');
    expect(latexBody('$$\\int_0^1 f$$')).toBe('\\int_0^1 f');
    expect(latexBody('\\(a+b\\)')).toBe('a+b');
  });

  it('leaves text that only partly holds math as it is', () => {
    expect(latexBody('a $x$ and $y$')).toBe('a $x$ and $y$');
    expect(latexBody('\\begin{align*} x &= 1 \\end{align*}')).toBe('\\begin{align*} x &= 1 \\end{align*}');
  });
});
