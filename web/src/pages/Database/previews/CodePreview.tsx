import { useEffect, useState } from 'react';

type CodePreviewProps = {
  code: string;
  /** Shiki's language id (`python`, `markdown`, `latex`, ...) or shiki's `text` for plain. */
  lang: string;
  /** Extra classes on the block, e.g. a notebook cell's. */
  className?: string;
};

type Highlighter = (code: string, lang: string) => Promise<string | null>;

let highlighter: Promise<Highlighter> | null = null;

/**
 * Shiki and its grammars weigh a few hundred KB, so they load on the first code
 * preview, not with the page. One `github-dark-dimmed` theme, the one the spec names.
 */
function loadHighlighter(): Promise<Highlighter> {
  highlighter ??= import('shiki').then(async ({ createHighlighter }) => {
    const theme = 'github-dark-dimmed';
    const hl = await createHighlighter({
      themes: [theme],
      langs: ['python', 'javascript', 'typescript', 'tsx', 'jsx', 'c', 'cpp', 'java', 'r', 'matlab', 'julia', 'go', 'rust', 'shell', 'sql', 'markdown', 'latex'],
    });
    const loaded = new Set(hl.getLoadedLanguages());
    return async (code, lang) => {
      const language = loaded.has(lang) ? lang : 'text';
      return hl.codeToHtml(code, { lang: language, theme });
    };
  });
  return highlighter;
}

/**
 * A code block with Shiki highlighting. The markup is Shiki's, built from the code
 * and never from HTML on the wire; until it lands (or if it fails) the plain text shows.
 */
export function CodePreview({ code, lang, className }: CodePreviewProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setHtml(null);
    loadHighlighter()
      .then((highlight) => highlight(code, lang))
      .then((out) => {
        if (live) setHtml(out);
      })
      .catch(() => {
        // Shiki could not load: the plain text below stays.
      });
    return () => {
      live = false;
    };
  }, [code, lang]);

  const classes = className ? `code ${className}` : 'code';
  if (html !== null) {
    return <div className={classes} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className={classes}>
      <pre className="code__plain">
        <code>{code}</code>
      </pre>
    </div>
  );
}
