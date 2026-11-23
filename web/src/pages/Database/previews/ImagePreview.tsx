import { useState } from 'react';
import type { Attachment } from '@shared/types.ts';

/** A photo or notebook output. `onOpen` asks the parent for the lightbox, where the page has one. */
export function ImagePreview({ file, onOpen }: { file: Attachment; onOpen?: (file: Attachment) => void }) {
  // A HEIC/HEIF photo is shown from its JPEG preview once macOS has made one.
  const src = file.previewUrl ?? file.url;
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <p className="pv-note">
        Couldn’t show this photo.{' '}
        <a href={file.url} download={file.filename}>
          Download the original
        </a>
      </p>
    );
  }
  return (
    <button
      type="button"
      className="pv-image"
      onClick={() => onOpen?.(file)}
      aria-label={`Open ${file.filename} larger`}
      disabled={onOpen === undefined}
    >
      <img src={src} alt={file.filename} loading="lazy" onError={() => setBroken(true)} />
    </button>
  );
}
