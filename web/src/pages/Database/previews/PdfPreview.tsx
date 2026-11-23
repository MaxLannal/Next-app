import type { Attachment } from '@shared/types.ts';

/** A PDF in the browser's own viewer, with the original one click away. */
export function PdfPreview({ file }: { file: Attachment }) {
  return (
    <div className="pv-pdf">
      <object data={file.url} type="application/pdf" aria-label={file.filename}>
        <p className="pv-note">
          The browser won’t show this PDF.{' '}
          <a href={file.url} download={file.filename}>
            Download it
          </a>
        </p>
      </object>
    </div>
  );
}
