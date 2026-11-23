import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { Attachment, FocusSession } from '@shared/types.ts';
import { api, ApiError } from '../../api.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Sheet } from '../../components/ui/Sheet.tsx';
import { formatDuration, formatShortDate, formatTime, sizeOf } from '../../lib/format.ts';
import { GitHubFileBadge } from './GitHubFileBadge.tsx';
import { DownloadLink, AttachmentPreview } from './previews/AttachmentPreview.tsx';

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError && err.status !== 0 ? err.message : fallback);

/**
 * One session: what it was, then every file it holds with a preview, its GitHub state
 * and a download; then more files to add and its notes, editable in place.
 */
export function SessionDetail() {
  const { id } = useParams();
  const sessionId = id !== undefined && /^[1-9][0-9]*$/.test(id) ? Number(id) : null;
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: ({ signal }) => api<FocusSession>(`/api/sessions/${sessionId}`, { signal }),
    enabled: sessionId !== null,
  });
  const files = useQuery({
    queryKey: ['attachments', 'session', sessionId],
    queryFn: ({ signal }) => api<Attachment[]>(`/api/attachments?sessionId=${sessionId}`, { signal }),
    enabled: sessionId !== null,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['attachments', 'session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  }, [queryClient, sessionId]);

  if (sessionId === null) return <p className="db-detail__back"><Link to="/database">Back to the database</Link></p>;
  if (session.isError) {
    return (
      <div className="db-detail">
        <p className="db-detail__back"><Link to="/database">Back to the database</Link></p>
        <EmptyState
          title={session.error instanceof ApiError && session.error.status === 404 ? 'No session at this address' : 'Couldn’t load this session'}
          line={messageOf(session.error, 'The hub didn’t answer.')}
        />
      </div>
    );
  }
  if (session.data === undefined) return <p className="db-detail__note">Loading…</p>;

  const s = session.data;
  return (
    <div className="db-detail">
      <p className="db-detail__back">
        <Link to="/database">← Database</Link>
      </p>
      <header className="db-detail__head">
        <div>
          <p className="db-detail__when num">
            {formatShortDate(s.startedAt)} · {formatTime(s.startedAt)}
            {s.endedAt !== null && `–${formatTime(s.endedAt)}`} · {formatDuration(s.focusSeconds)}
          </p>
          <h1 className="db-detail__title">{s.name}</h1>
          <p className="db-detail__where">
            <span className={s.subject === null ? 'db-chip is-quiet' : 'db-chip'}>{s.subject?.name ?? 'No subject'}</span>
            {s.tags.map((tag) => (
              <span className="db-chip is-soft" key={tag}>
                {tag}
              </span>
            ))}
            {s.goalId !== null && <span className="db-chip is-soft num">Goal {s.goalId}</span>}
          </p>
        </div>
      </header>

      <FileWall files={files.data ?? []} loading={files.isLoading} error={files.error} />

      <Panel title="Add files" className="db-add">
        <FileDrop sessionId={s.id} onUploaded={refresh} />
      </Panel>

      <Notes session={s} />
    </div>
  );
}

/**
 * Every file, grouped in attachment order with each photo's derived files (a `.tex`
 * reading) right after it. Pictures open in a lightbox.
 */
function FileWall({ files, loading, error }: { files: Attachment[]; loading: boolean; error: unknown }) {
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  if (loading) return <p className="db-detail__note">Loading files…</p>;
  if (error !== null && error !== undefined) return <EmptyState title="Couldn’t load the files" line={messageOf(error, 'The hub didn’t answer.')} />;
  if (files.length === 0) {
    return <EmptyState title="No files yet" line="Drop photos or files below; each is filed with this session." />;
  }

  const roots = files.filter((f) => f.parentId === null);
  const children = new Map<number, Attachment[]>();
  for (const file of files) {
    if (file.parentId === null) continue;
    const list = children.get(file.parentId) ?? [];
    list.push(file);
    children.set(file.parentId, list);
  }

  return (
    <>
      <ol className="db-files">
        {roots.map((file, i) => (
          <li className="db-file rise" style={{ '--d': i } as CSSProperties} key={file.id}>
            <header className="db-file__head">
              <a className="db-file__name" href={file.url} download={file.filename}>
                {file.filename}
              </a>
              <span className="db-file__meta num">
                {file.kind}
                {file.kind !== 'image' && ` · ${sizeOf(file.size)}`}
              </span>
              <GitHubFileBadge file={file} />
              <DownloadLink file={file} />
            </header>
            <AttachmentPreview file={file} onOpenImage={setLightbox} />
            {(children.get(file.id) ?? []).map((child) => (
              <div className="db-file__child" key={child.id}>
                <header className="db-file__head">
                  <span className="db-file__name">{child.filename}</span>
                  <span className="db-file__meta">Read from the photo</span>
                  <GitHubFileBadge file={child} />
                  <DownloadLink file={child} />
                </header>
                <AttachmentPreview file={child} />
              </div>
            ))}
          </li>
        ))}
      </ol>
      <ImageLightbox file={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}

function ImageLightbox({ file, onClose }: { file: Attachment | null; onClose: () => void }) {
  return (
    <Sheet open={file !== null} onClose={onClose} title={file?.filename ?? 'Photo'}>
      {file !== null && (
        <div className="db-lightbox">
          <img src={file.url} alt={file.filename} />
          <p className="db-lightbox__foot">
            <DownloadLink file={file} />
          </p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * "Add files": the wrap-up sheet's drop zone, for a session that is already over.
 * Drops or the button's file picker upload them to this session; each failure names
 * the file and leaves the rest to land.
 *
 * Task 7 slot: when `web/src/pages/Dashboard/focus/FileDrop.tsx` lands (`<FileDrop
 * sessionId onUploaded />`), swap this for it. The props match, so nothing else moves.
 */
function FileDrop({ sessionId, onUploaded }: { sessionId: number; onUploaded: () => void }) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  const upload = async (list: File[]) => {
    if (list.length === 0) return;
    setBusy(true);
    setFailed([]);
    const form = new FormData();
    form.append('sessionId', String(sessionId));
    for (const file of list) form.append('files', file, file.name);
    try {
      await api<Attachment[]>('/api/attachments', { method: 'POST', body: form });
      onUploaded();
    } catch (err) {
      setFailed([messageOf(err, 'Couldn’t upload — retry')]);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void upload([...e.dataTransfer.files]);
  };

  return (
    <div
      className={over ? 'db-drop is-over' : 'db-drop'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <p className="db-drop__line">Drop photos, code, PDFs or notes here.</p>
      <label className="btn btn-ghost btn-sm" htmlFor={inputId}>
        {busy ? 'Uploading…' : 'Choose files'}
      </label>
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        multiple
        disabled={busy}
        onChange={(e) => {
          void upload([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {failed.map((line) => (
        <p className="db-drop__error" role="alert" key={line}>
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * Notes, saved on blur and 800 ms after typing stops. A failed save keeps the text on
 * screen and says so; the next edit tries again.
 */
function Notes({ session }: { session: FocusSession }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(session.notes);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const saved = useRef(session.notes);
  const timer = useRef<number | undefined>(undefined);
  const textId = useId();

  useEffect(() => {
    setText(session.notes);
    saved.current = session.notes;
  }, [session.notes]);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (text === saved.current) return;
    setStatus('saving');
    try {
      const updated = await api<FocusSession>(`/api/sessions/${session.id}`, { method: 'PATCH', json: { notes: text } });
      saved.current = updated.notes;
      setStatus('saved');
      queryClient.setQueryData(['session', session.id], updated);
    } catch (err) {
      setStatus('failed');
      setLastError(messageOf(err, 'Not saved — the hub didn’t answer'));
    }
  }, [queryClient, session.id, text]);

  const [lastError, setLastError] = useState('Not saved — retrying');

  useEffect(() => {
    if (text === saved.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(timer.current);
  }, [text, save]);

  return (
    <Panel
      title="Notes"
      className="db-notes"
      actions={
        <span className={status === 'failed' ? 'db-notes__status is-apricot' : 'db-notes__status'} aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'failed' ? lastError : ''}
        </span>
      }
    >
      <label className="visually-hidden" htmlFor={textId}>
        Notes
      </label>
      <textarea
        id={textId}
        className="db-notes__field"
        value={text}
        rows={Math.min(14, Math.max(5, text.split('\n').length + 1))}
        placeholder="What you worked through, what is left"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
      />
    </Panel>
  );
}
