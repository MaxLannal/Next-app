import { useCallback, useEffect, useRef, useState } from 'react';

type CameraCaptureProps = {
  /** Each photo taken, as a JPEG file named for the moment it was taken. */
  onPhoto: (file: File) => void;
  disabled?: boolean;
};

/** Whether this browser hands the page a live camera at all (phones mostly do not). */
const canStream = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  HTMLCanvasElement.prototype.toBlob !== undefined;

const photoName = () =>
  `photo ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;

/**
 * "Take photo": the Mac's camera through `getUserMedia` in a small preview,
 * or, where the page can't open one (iOS and most phones), the native camera
 * through a file field that asks for the rear lens.
 */
export function CameraCapture({ onPhoto, disabled = false }: CameraCaptureProps) {
  const [streaming, setStreaming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => stop, [stop]);

  const open = async () => {
    setProblem(null);
    if (disabled) return;
    if (!canStream()) {
      fileInput.current?.click();
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      setStreaming(true);
    } catch {
      setProblem('Couldn’t open the camera — choose a photo instead');
      fileInput.current?.click();
    }
  };

  useEffect(() => {
    if (streaming && video.current && stream.current) video.current.srcObject = stream.current;
  }, [streaming]);

  const take = () => {
    const el = video.current;
    if (disabled || !el || el.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext('2d')?.drawImage(el, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onPhoto(new File([blob], photoName(), { type: 'image/jpeg' }));
        stop();
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <div className="capture">
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && !disabled) onPhoto(file);
          e.target.value = '';
        }}
      />
      {!streaming ? (
        <button className="btn btn-ghost" type="button" onClick={() => void open()} disabled={disabled}>
          Take photo
        </button>
      ) : (
        <div className="capture__live">
          <video ref={video} className="capture__video" autoPlay playsInline muted aria-label="Camera preview" />
          <div className="capture__acts">
            <button className="btn btn-sm" type="button" onClick={take} disabled={disabled}>
              Use this photo
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={stop}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {problem !== null && (
        <p className="capture__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
