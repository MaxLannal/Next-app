import katex from 'katex';

// A reading of a page of work is LaTeX body content: words, with math in $...$, \[...\] and
// align* blocks. This typesets it the way a compiled document would read: paragraphs of text, the
// math in them set with KaTeX, displayed math on its own lines. Text is escaped; only KaTeX writes
// markup, and it never follows links or runs anything (trust is off).

const MATH_ENVS = [
  'align', 'align\\*', 'aligned', 'alignat', 'alignat\\*', 'alignedat', 'equation', 'equation\\*',
  'gather', 'gather\\*', 'gathered', 'multline', 'multline\\*', 'split', 'eqnarray', 'eqnarray\\*',
  'cases', 'array', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'CD',
].join('|');

/** Display math ($$…$$, \[…\], a math environment) and inline math (\(…\), $…$), in that order of precedence. */
const MATH = new RegExp(
  String.raw`\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|(\\begin\{(${MATH_ENVS})\}[\s\S]*?\\end\{\4\})|\\\(([\s\S]+?)\\\)|\$((?:\\.|[^$\\])+?)\$`,
  'g',
);
/** Environments KaTeX sets only as their content, not by name. */
const UNWRAP = /^\\begin\{(equation\*?|multline\*?|eqnarray\*?)\}([\s\S]*)\\end\{\1\}$/;

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function math(src: string, display: boolean): string {
  const tex = src.trim().replace(UNWRAP, (_, _env: string, body: string) => body);
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore' });
}

/** The common text commands of a page, as HTML; anything else is shown as written. */
function prose(text: string): string {
  let html = escape(text);
  const arg = String.raw`\{([^{}]*)\}`;
  html = html
    .replace(new RegExp(String.raw`\\(?:sub)*section\*?` + arg, 'g'), '<strong class="latex__heading">$1</strong>')
    .replace(new RegExp(String.raw`\\paragraph\*?` + arg, 'g'), '<strong>$1</strong>')
    .replace(new RegExp(String.raw`\\textbf` + arg, 'g'), '<strong>$1</strong>')
    .replace(new RegExp(String.raw`\\(?:textit|emph)` + arg, 'g'), '<em>$1</em>')
    .replace(new RegExp(String.raw`\\underline` + arg, 'g'), '<u>$1</u>')
    .replace(new RegExp(String.raw`\\(?:text|textrm|textsf|mbox)` + arg, 'g'), '$1')
    .replace(/\\begin\{(?:itemize|enumerate|description)\}|\\end\{(?:itemize|enumerate|description)\}/g, '')
    .replace(/\\item(?:\[([^\]]*)\])?\s*/g, (_, label?: string) => `<br>${label ? `<strong>${label}</strong> ` : '• '}`)
    .replace(/\\\\(?:\[[^\]]*\])?|\\newline\b/g, '<br>')
    .replace(/\\(?:noindent|medskip|bigskip|smallskip|hfill|par)\b|\\vspace\*?\{[^}]*\}/g, '')
    .replace(/\\(?:q?quad)\b|\\[,;: ]/g, ' ')
    .replace(/\\(?:ldots|dots)\b/g, '…')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/~/g, '&nbsp;')
    .replace(/\\([%$#_{}])/g, '$1')
    .replace(/\\&amp;/g, '&amp;');
  return html;
}

/** Whether text with no math delimiters is itself one piece of math (an older reading, or a bare formula). */
const looksLikeMath = (text: string) => /\\[a-zA-Z]+|[\^_=]/.test(text) && !/\b[a-zA-Z]{3,}\s+[a-zA-Z]{3,}\s+[a-zA-Z]{3,}\b/.test(text.replace(/\\[a-zA-Z]+/g, ''));

/** A reading (LaTeX body content) as HTML: paragraphs of text and math, displayed math set apart. */
export function latexToHtml(source: string): string {
  const src = source.trim();
  if (src === '') return '';
  MATH.lastIndex = 0;
  if (!MATH.test(src)) {
    MATH.lastIndex = 0;
    if (looksLikeMath(src)) return `<div class="latex__display">${math(src, true)}</div>`;
  }
  MATH.lastIndex = 0;

  const blocks: string[] = [];
  let paragraph = '';
  const endParagraph = () => {
    if (paragraph.replace(/<br>/g, '').trim() !== '') blocks.push(`<p>${paragraph.trim().replace(/^(<br>)+/, '')}</p>`);
    paragraph = '';
  };
  const addText = (text: string) => {
    // A blank line ends a paragraph; a single line break is a space, as in LaTeX.
    const parts = text.split(/\n\s*\n/);
    parts.forEach((part, i) => {
      if (i > 0) endParagraph();
      paragraph += prose(part.replace(/\s*\n\s*/g, ' '));
    });
  };

  let at = 0;
  for (const m of src.matchAll(MATH)) {
    addText(src.slice(at, m.index));
    const [, dollars, brackets, env, , paren, dollar] = m;
    if (dollars !== undefined || brackets !== undefined || env !== undefined) {
      endParagraph();
      blocks.push(`<div class="latex__display">${math(dollars ?? brackets ?? env!, true)}</div>`);
    } else {
      paragraph += math(paren ?? dollar ?? '', false);
    }
    at = m.index + m[0].length;
  }
  addText(src.slice(at));
  endParagraph();
  return blocks.join('');
}
