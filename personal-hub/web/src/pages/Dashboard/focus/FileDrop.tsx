import { useId, useState, type DragEvent } from 'react';

type FileDropProps = {
  /** Every file dropped or chosen, in the order given. */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
};

/** "Upload files": drop any number of them on it, or choose them from disk. */
export function FileDrop({ onFiles, disabled = false }: FileDropProps) {
  const id = useId();
  const [over, setOver] = useState(false);

  const leave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };

  return (
    <div
      className={over ? 'filedrop is-over' : 'filedrop'}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={leave}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = [...e.dataTransfer.files];
        if (files.length > 0) onFiles(files);
      }}
    >
      <label className="btn btn-ghost filedrop__pick" htmlFor={id}>
        Upload files
      </label>
      <input
        id={id}
        className="visually-hidden"
        type="file"
        multiple
        disabled={disabled}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
      />
      <span className="filedrop__hint">or drop them here</span>
    </div>
  );
}
