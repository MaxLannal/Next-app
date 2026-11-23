import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Essay } from '@shared/types.ts';
import { plainTextOf } from '@shared/essayText.ts';
import { api, ApiError } from '../../../api.ts';
import { Sheet } from '../../../components/ui/Sheet.tsx';
import { formatTime } from '../../../lib/format.ts';
import { extensions, uploadImage } from './extensions.ts';
import { toDocx } from './exportDocx.ts';
import { FindReplaceBar } from './FindReplaceBar.tsx';
import { Toolbar, type ExportKind } from './Toolbar.tsx';
import { backupTime, clearBackup, readBackup, useAutosave, type UnsavedBackup } from './useAutosave.ts';
import '../essays.css';
import 'katex/dist/katex.min.css';
import './print.css';

type Snapshot = { id: number; createdAt: string };

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/** The document as a plain object whatever the hub sent. */
function documentOf(contentJson: unknown): object {
  if (typeof contentJson === 'object' && contentJson !== null) return contentJson;
  if (typeof contentJson === 'string') {
    try {
      return JSON.parse(contentJson) as object;
    } catch {
      return EMPTY_DOC;
    }
  }
  return EMPTY_DOC;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // The browser reads the blob before this runs.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileSafe = (title: string) => (title.trim() === '' ? 'Untitled essay' : title.trim()).replace(/[\\/:*?"<>|]+/g, '—').slice(0, 80);

/**
 * One essay, full page: a reading column on bone paper with a title field above
 * it. Autosaves 800 ms after typing stops and keeps a backup when the hub can't
 * be reached. The toolbar is sticky above the page.
 */
export function EssayEditor() {
  const { id: rawId } = useParams();
  const essayId = Number(rawId);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['essay', essayId],
    queryFn: ({ signal }) => api<Essay>(`/api/essays/${essayId}`, { signal }),
    enabled: Number.isInteger(essayId) && essayId > 0,
    // The editor holds the document once it is open; a refetch would overwrite typing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const essay = query.data;

  if (!Number.isInteger(essayId) || essayId <= 0) {
    return (
      <div className="container page">
        <p role="alert">No such essay.</p>
        <Link to="/essays">Back to Essays</Link>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="container page">
        <p role="alert">{query.error instanceof ApiError && query.error.status === 404 ? 'No such essay.' : 'Couldn’t open this essay — retry.'}</p>
        <Link to="/essays">Back to Essays</Link>
      </div>
    );
  }
  if (!essay) {
    return (
      <div className="container page">
        <p className="page__lead" aria-busy="true">
          Opening…
        </p>
      </div>
    );
  }

  return (
    <EssayWorkspace
      key={essay.id}
      essay={essay}
      onRestored={(restored) => {
        queryClient.setQueryData(['essay', essayId], restored);
      }}
    />
  );
}

type WorkspaceProps = {
  essay: Essay;
  onRestored: (essay: Essay) => void;
};

function EssayWorkspace({ essay, onRestored }: WorkspaceProps) {
  const [title, setTitle] = useState(essay.title);
  const [base, setBase] = useState(essay.updatedAt);
  const [find, setFind] = useState<'find' | 'replace' | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  // A backup exists; whether it is newer than the essay is known once the essay is here.
  const [backup, setBackup] = useState<UnsavedBackup | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const baseRef = useRef(base);
  baseRef.current = base;

  const editor = useEditor(
    {
      extensions: extensions(),
      content: documentOf(essay.contentJson),
      editorProps: { attributes: { class: 'essay-doc', 'aria-label': 'Essay' } },
      immediatelyRender: false,
    },
    [essay.id],
  );

  const getPayload = useCallback(
    () => {
      const json = editor?.getJSON() ?? { ...EMPTY_DOC };
      return {
        title: titleRef.current,
        contentJson: json,
        plainText: plainTextOf(json),
        baseUpdatedAt: baseRef.current,
      };
    },
    [editor],
  );

  const autosave = useAutosave(essay.id, getPayload);
  const { notifyChange, flush } = autosave;

  // The shared backup, if one is newer than the essay: the offer to restore it.
  useEffect(() => {
    const at = backupTime(essay.id);
    if (at !== null && at > essay.updatedAt) setBackup(readBackup(essay.id));
  }, [essay.id, essay.updatedAt]);

  // Every change the document makes is a change to save.
  useEffect(() => {
    if (!editor) return;
    const onChange = () => notifyChange();
    editor.on('update', onChange);
    return () => {
      editor.off('update', onChange);
    };
  }, [editor, notifyChange]);

  // ⌘F opens find, ⌘⌥F find and replace; ⌘S saves now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        setFind(e.altKey ? 'replace' : 'find');
      } else if (key === 's') {
        e.preventDefault();
        void autosave.flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autosave]);

  const restoreBackup = () => {
    if (!backup || !editor) return;
    editor.commands.setContent(documentOf(backup.payload.contentJson));
    setTitle(backup.payload.title);
    setBase(backup.payload.baseUpdatedAt);
    baseRef.current = backup.payload.baseUpdatedAt;
    titleRef.current = backup.payload.title;
    clearBackup(essay.id);
    setBackup(null);
    setMessage('Restored the unsaved changes.');
    notifyChange();
  };

  const discardBackup = () => {
    clearBackup(essay.id);
    setBackup(null);
  };

  const runExport = async (kind: ExportKind) => {
    if (!editor) return;
    if (kind === 'print') {
      window.print();
      return;
    }
    if (kind === 'pdf') {
      window.print();
      return;
    }
    setExporting('docx');
    setMessage(null);
    try {
      const blob = await toDocx(editor.getJSON(), title);
      download(blob, `${fileSafe(title)}.docx`);
    } catch {
      setMessage('Couldn’t make the .docx — try again.');
    } finally {
      setExporting(null);
    }
  };

  const insertImage = async (file: File) => {
    if (!editor) return;
    try {
      const url = await uploadImage(file);
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch {
      setMessage('Couldn’t upload that image — retry.');
    }
  };

  // A paste or drop that failed to upload says so in the status line.
  useEffect(() => {
    const onFailed = () => setMessage('Couldn’t upload that image — retry.');
    window.addEventListener('hub:image-upload-failed', onFailed);
    return () => window.removeEventListener('hub:image-upload-failed', onFailed);
  }, []);

  const words = editor?.storage.characterCount.words() ?? essay.wordCount;
  const characters = editor?.storage.characterCount.characters() ?? 0;

  return (
    <div className="editor-page">
      <header className="editor-top container">
        <Link className="editor-back" to="/essays">
          ← Essays
        </Link>
        <span className="editor-column">{essay.column === 'meditations' ? 'Personal meditations' : essay.column === 'plans' ? 'Plans' : 'Insights'}</span>
      </header>

      {editor && (
        <>
          <Toolbar
            editor={editor}
            exporting={exporting}
            onExport={(kind) => void runExport(kind)}
            onFindReplace={(mode) => setFind(mode)}
            onImage={() => imageInput.current?.click()}
            onLink={() => {
              const previous = editor.getAttributes('link').href as string | undefined;
              const href = window.prompt('Link address', previous ?? 'https://');
              if (href === null) return;
              if (href.trim() === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
              else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
            }}
            onHistory={() => setHistory(true)}
          />
          {find !== null && <FindReplaceBar editor={editor} mode={find} onClose={() => setFind(null)} />}
        </>
      )}

      <input
        ref={imageInput}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void insertImage(file);
        }}
      />

      <div className="container editor-stage">
        {backup !== null && (
          <div className="editor-backup" role="status">
            <span>Restore unsaved changes from {formatTime(backup.at)}?</span>
            <button type="button" className="btn btn-sm" onClick={restoreBackup}>
              Restore
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={discardBackup}>
              Discard
            </button>
          </div>
        )}
        {autosave.status === 'conflict' && (
          <div className="editor-conflict" role="alert">
            <span>Changed elsewhere — reload / keep mine</span>
            <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void autosave.keepMine()}>
              Keep mine
            </button>
          </div>
        )}

        <div className="well editor-well">
          <input
            className="editor-title"
            aria-label="Title"
            placeholder="Untitled"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              notifyChange();
            }}
            onBlur={() => void flush()}
          />
          <div className="editor-paper">
            <EditorContent editor={editor} />
          </div>
        </div>

        <footer className="editor-status" aria-live="polite">
          <span className="num">{words} words</span>
          <span aria-hidden="true"> · </span>
          <span className="num">{characters} characters</span>
          <span aria-hidden="true"> · </span>
          <Status status={autosave.status} savedAt={autosave.savedAt} />
        </footer>
      </div>

      {message !== null && (
        <p className="editor-message container" role="status">
          {message}
        </p>
      )}

      <HistorySheet open={history} onClose={() => setHistory(false)} essayId={essay.id} onRestored={onRestored} />
    </div>
  );
}

function Status({ status, savedAt }: { status: 'saved' | 'saving' | 'retrying' | 'conflict'; savedAt: string | null }) {
  if (status === 'saving') return <span>Saving…</span>;
  if (status === 'retrying') return <span className="is-warn">Not saved — retrying</span>;
  if (status === 'conflict') return <span className="is-warn">Changed elsewhere</span>;
  return <span>{savedAt === null ? 'Saved' : `Saved ${formatTime(savedAt)}`}</span>;
}

type HistoryProps = {
  open: boolean;
  onClose: () => void;
  essayId: number;
  onRestored: (essay: Essay) => void;
};

/** The last 30 snapshots, newest first; restoring one opens that version. */
function HistorySheet({ open, onClose, essayId, onRestored }: HistoryProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const snapshots = useQuery({
    queryKey: ['essay', essayId, 'snapshots', open],
    queryFn: ({ signal }) => api<Snapshot[]>(`/api/essays/${essayId}/snapshots`, { signal }),
    enabled: open,
    staleTime: 0,
  });

  const restore = async (id: number) => {
    setError(null);
    try {
      const essay = await api<Essay>(`/api/essays/${essayId}/snapshots/${id}/restore`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['essays'] });
      await queryClient.invalidateQueries({ queryKey: ['essay', essayId, 'snapshots'] });
      onRestored(essay);
      onClose();
    } catch {
      setError('Couldn’t restore that version — try another.');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="History">
      {snapshots.isError && <p role="alert">Couldn’t read the history — retry.</p>}
      {snapshots.data !== undefined && snapshots.data.length === 0 && (
        <p className="editor-history__empty">No snapshots yet. One is taken when an essay changes and is at least five minutes older than its last snapshot.</p>
      )}
      {error !== null && <p className="is-warn" role="alert">{error}</p>}
      <ul className="editor-history">
        {(snapshots.data ?? []).map((s) => (
          <li key={s.id} className="editor-history__row">
            <span>{formatTime(s.createdAt)}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void restore(s.id)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
