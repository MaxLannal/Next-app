import type { Attachment } from '@shared/types.ts';
import { LatexView } from '../../../components/LatexView.tsx';
import { CodePreview } from './CodePreview.tsx';
import { ImagePreview } from './ImagePreview.tsx';
import { languageOf } from './languages.ts';
import { NotebookPreview } from './NotebookPreview.tsx';
import { PdfPreview } from './PdfPreview.tsx';
import { TEXT_PREVIEW_LIMIT, useFileText } from './useFileText.ts';

type AttachmentPreviewProps = {
  file: Attachment;
  onOpenImage?: (file: Attachment) => void;
};

/** The original file, to keep. Stands beside any preview that fails. */
export function DownloadLink({ file }: { file: Attachment }) {
  return (
    <a className="btn btn-ghost btn-sm" href={file.url} download={file.filename}>
      Download
    </a>
  );
}

const isNotebook = (file: Attachment) => file.filename.toLowerCase().endsWith('.ipynb');

/**
 * The preview for one file, chosen by how the hub classified it:
 * images and PDFs in place, code and notebooks highlighted, LaTeX typeset, and
 * anything else (or a file too big to read, or a failed read) as a download.
 */
export function AttachmentPreview({ file, onOpenImage }: AttachmentPreviewProps) {
  if (file.kind === 'image') return <ImagePreview file={file} onOpen={onOpenImage} />;
  if (file.kind === 'pdf') return <PdfPreview file={file} />;
  if (file.kind === 'latex') return <LatexFile file={file} />;
  if (file.kind === 'code' && isNotebook(file)) return <NotebookPreview file={file} />;
  if (file.kind === 'code' || (file.kind === 'text' && file.size <= TEXT_PREVIEW_LIMIT)) return <TextFile file={file} />;
  return (
    <div className="pv-download">
      <p className="pv-note">{file.kind === 'text' ? 'Too large to show here — download it.' : 'No preview for this file.'}</p>
      <DownloadLink file={file} />
    </div>
  );
}

function TextFile({ file }: { file: Attachment }) {
  const read = useFileText(file.url, true);
  if (read === null) return <p className="pv-note">Reading…</p>;
  if ('error' in read) {
    return (
      <div className="pv-download">
        <p className="pv-note">{read.error}</p>
        <DownloadLink file={file} />
      </div>
    );
  }
  return <CodePreview code={read.text} lang={languageOf(file.filename)} />;
}

/**
 * A `.tex` file: its body, rendered. The hub's own readings of photos wrap the
 * body in a minimal document, so the wrapper is taken off before typesetting.
 */
function LatexFile({ file }: { file: Attachment }) {
  const read = useFileText(file.url, true);
  if (read === null) return <p className="pv-note">Reading…</p>;
  if ('error' in read) {
    return (
      <div className="pv-download">
        <p className="pv-note">{read.error}</p>
        <DownloadLink file={file} />
      </div>
    );
  }
  return <LatexView latex={latexBody(read.text)} />;
}

const DOCUMENT_BODY = /\\begin\{document\}([\s\S]*?)\\end\{document\}/;
/** A body that is one whole `$…$` or `$$…$$` expression, which KaTeX in display mode won't need. */
const WRAPPED_IN_MATH = /^(?:\$\$([^$]+)\$\$|\\\(([\s\S]*?)\\\)|\$([^$]+)\$)$/;

const unwrap = (text: string): string => {
  const match = WRAPPED_IN_MATH.exec(text);
  return match === null ? text : (match[1] ?? match[2] ?? match[3] ?? '').trim();
};

/**
 * The body KaTeX is given: what sits inside `document` (or the whole text), with a
 * whole-expression `$…$` / `$$…$$` unwrapped. A body mixing text and math keeps its `$`s.
 */
export function latexBody(text: string): string {
  return unwrap((DOCUMENT_BODY.exec(text)?.[1] ?? text).trim());
}
