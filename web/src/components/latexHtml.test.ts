import { describe, expect, it } from 'vitest';
import { latexToHtml } from './latexHtml.ts';

const text = (html: string) => html.replace(/<span class="katex-mathml">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '');

describe('a reading as typeset HTML', () => {
  it('sets words as text and inline math with KaTeX, in paragraphs split at blank lines', () => {
    const html = latexToHtml('\\textbf{7.1} Let $a<b$ be points in $I$.\n\nBy Rolle\'s theorem, $f\'(d)=0$.');
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain('<strong>7.1</strong>');
    expect(html).toContain('class="katex"');
    expect(text(html)).toContain('By Rolle');
    expect(html).not.toContain('katex-error');
  });

  it('sets displayed math and align* working apart, as display math', () => {
    const html = latexToHtml('Then\n\\[ \\lim_{x\\to 0} \\frac{1}{x^{2n}} = \\infty \\]\nand\n\\begin{align*} x^{2n} &< \\tfrac{1}{M} \\\\ |x| &< \\sqrt[2n]{1/M} \\end{align*}');
    expect(html.match(/class="latex__display"/g)).toHaveLength(2);
    expect(html).toContain('katex-display');
    expect(html).not.toContain('katex-error');
  });

  it('keeps an older reading that is one piece of math, with no delimiters, as display math', () => {
    expect(latexToHtml('x^2+1=0')).toContain('katex-display');
    expect(latexToHtml('\\frac{a}{b} = c')).toContain('katex-display');
  });

  it('escapes text, so a reading can never write markup of its own', () => {
    const html = latexToHtml('A <script>alert(1)</script> & $x$');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('shows broken math as written instead of failing the page', () => {
    expect(() => latexToHtml('Here $\\frac{1$ is broken.')).not.toThrow();
    expect(latexToHtml('')).toBe('');
  });
});
