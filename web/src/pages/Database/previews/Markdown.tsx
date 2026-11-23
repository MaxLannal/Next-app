import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [rehypeKatex];
// Links become text: a notebook's or an essay's links must not take the page elsewhere.
const COMPONENTS: Components = { a: ({ children }) => <span className="md__link">{children}</span> };

/** Markdown with tables (GFM) and `$…$` math (KaTeX), for notebook cells and notes. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
