import { useId, useState } from 'react';
import type { Attachment, FocusSession } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { LatexView } from '../../../components/LatexView.tsx';
import { Sheet } from '../../../components/ui/Sheet.tsx';
import { formatClock, formatDuration, formatShortDate, timeValue } from '../../../lib/format.ts';
import { CameraCapture } from './CameraCapture.tsx';
import { FileDrop } from './FileDrop.tsx';
import { endAfter, startBefore } from './sessionTimes.ts';
import { isReadable, latexChild, useEditReading, useRetryReading, useSessionAttachments, useUpload } from './useAttachments.ts';
import './focus.css';

/** Past this many focused seconds the end time probably caught a forgotten stop. */
export const LONG_SESSION_SECONDS = 6 * 60 * 60;
const LONG_LINE = 'Long session — check the end time';

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.status !== 0 && err.message !== '' ? err.message : fallback;

type WrapUpSheetProps = {
  session: FocusSession;
  open: boolean;
  onClose: () => void;
  /** A save changed the session or its files; the panel re-reads what it shows. */
  onSaved?: () => void;
};

/**
 * The session after Stop, and again whenever a row is reopened: its name, its
 * start, end and focused time (edits go by PATCH), its notes on blur, photos
 * and files as they land, every reading (typeset LaTeX, editable, re-runnable),
 * and Save to close.
 */
export function WrapUpSheet({ session, open, onClose, onSaved }: WrapUpSheetProps) {
  if (!open) return null;
  return <WrapUpBody session={session} onClose={onClose} onSaved={onSaved} />;
}

function WrapUpBody({ session: first, onClose, onSaved }: Omit<WrapUpSheetProps, 'open'>) {
  const id = useId();
  const [session, setSession] = useState(first);
  const [name, setName] = useState(first.name);
  const [notes, setNotes] = useState(first.notes);
  const [start, setStart] = useState(timeValue(first.startedAt));
  const [end, setEnd] = useState(first.endedAt === null ? '' : timeValue(first.endedAt));
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const attachments = useSessionAttachments(session.id);
  const upload = useUpload(session.id);
  const editReading = useEditReading(session.id);
  const retryReading = useRetryReading(session.id);

  const files = attachments.data ?? [];
  const long = session.focusSeconds > LONG_SESSION_SECONDS;

  const changed = () => onSaved?.();

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      const updated = await api<FocusSession>(`/api/sessions/${session.id}`, { method: 'PATCH', json: body });
      setSession(updated);
      setName(updated.name);
      changed();
    } catch (err) {
      setError(messageOf(err, 'Couldn’t save that — retry'));
    }
  };

  const saveName = () => {
    const clean = name.trim();
    if (clean === '' || clean === session.name) {
      setName(session.name);
      return;
    }
    void patch({ name: clean });
  };

  const saveNotes = () => {
    if (notes === session.notes) return;
    void patch({ notes });
  };

  // A time is typed without a day: a start is the last such time before the end (or now), an end
  // the first after the start. So 23:00 to 02:00 runs over midnight, and they can't cross.
  const saveTimes = (which: 'start' | 'end') => {
    const typed = which === 'start' ? start : end;
    const saved = which === 'start' ? session.startedAt : session.endedAt;
    if (saved !== null && typed === timeValue(saved)) return;
    const at = which === 'start' ? startBefore(typed, new Date(session.endedAt ?? Date.now())) : endAfter(typed, new Date(session.startedAt));
    if (at === null) {
      setError('That isn’t a time');
      return;
    }
    void patch({ [which === 'start' ? 'startedAt' : 'endedAt']: at.toISOString() });
  };

  const addFiles = (list: File[]) => {
    setError(null);
    upload.mutate(list, { onSuccess: changed, onError: (err) => setError(messageOf(err, 'Couldn’t upload those — retry')) });
  };

  const saveReading = (photo: Attachment, latex: string) => {
    editReading.mutate(
      { id: photo.id, latex },
      {
        onSuccess: () => {
          setEditing(null);
          changed();
        },
        onError: (err) => setError(messageOf(err, 'Couldn’t save that — retry')),
      },
    );
  };

  // Photos and scanned PDFs are read for the math in them; their readings show beneath them.
  const photos = files.filter(isReadable);
  const others = files.filter((a) => !isReadable(a) && a.kind !== 'latex');
  // A derived `.tex` is shown under its photo, never twice.
  const shown = files.filter((a) => a.kind !== 'latex');

  return (
    <Sheet open onClose={onClose} title="Wrap up">
      <div className="wrap">
        <div className="wrap__field">
          <label className="wrap__label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input
            id={`${id}-name`}
            className="wrap__input"
            value={name}
            data-autofocus
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>

        <div className="wrap__times">
          <div className="wrap__field">
            <label className="wrap__label" htmlFor={`${id}-start`}>
              Start
            </label>
            <input
              id={`${id}-start`}
              className="wrap__input wrap__input--time"
              type="time"
              value={start}
              aria-describedby={`${id}-start-day`}
              onChange={(e) => setStart(e.target.value)}
              onBlur={() => saveTimes('start')}
            />
            <span id={`${id}-start-day`} className="wrap__day">
              {formatShortDate(session.startedAt)}
            </span>
          </div>
          {session.endedAt !== null && (
            <div className="wrap__field">
              <label className="wrap__label" htmlFor={`${id}-end`}>
                End
              </label>
              <input
                id={`${id}-end`}
                className="wrap__input wrap__input--time"
                type="time"
                value={end}
                aria-describedby={`${id}-end-day`}
                onChange={(e) => setEnd(e.target.value)}
                onBlur={() => saveTimes('end')}
              />
              <span id={`${id}-end-day`} className="wrap__day">
                {formatShortDate(session.endedAt)}
              </span>
            </div>
          )}
          <p className="wrap__focused">
            <span className="wrap__label">Focused</span>
            <span className="wrap__focused-value num">{formatDuration(session.focusSeconds)}</span>
            <span className="wrap__clock num">
              {formatShortDate(session.startedAt)} · {formatClock(session.focusSeconds)}
            </span>
          </p>
        </div>

        {long && (
          <p className="wrap__long" role="status">
            {LONG_LINE}
          </p>
        )}

        <div className="wrap__field">
          <label className="wrap__label" htmlFor={`${id}-notes`}>
            Notes
          </label>
          <textarea
            id={`${id}-notes`}
            className="wrap__input wrap__notes"
            rows={3}
            value={notes}
            placeholder="What moved, what’s left"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
          />
        </div>

        <div className="wrap__add">
          <CameraCapture onPhoto={(file) => addFiles([file])} disabled={upload.isPending} />
          <FileDrop onFiles={addFiles} disabled={upload.isPending} />
        </div>

        {upload.isPending && <p className="wrap__note">Saving files…</p>}
        {error !== null && (
          <p className="wrap__error" role="alert">
            {error}
          </p>
        )}

        {files.length > 0 && (
          <ul className="wrap__files" aria-label="Attached files">
            {photos.map((photo) => {
              const tex = latexChild(photo, files);
              return (
                <li key={photo.id} className="filerow">
                  <a className="filerow__name" href={photo.previewUrl ?? photo.url} target="_blank" rel="noreferrer">
                    {photo.filename}
                  </a>
                  <span className="filerow__status">{photoStatus(photo)}</span>
                  {photo.extractedText !== '' && photo.visionStatus === 'done' && (
                    <p className="filerow__text">{photo.extractedText}</p>
                  )}
                  {photo.visionStatus === 'failed' && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => retryReading.mutate(photo.id)}
                      disabled={retryReading.isPending}
                    >
                      Retry
                    </button>
                  )}
                  {tex !== null &&
                    (editing === photo.id ? (
                      <div key={photo.id} className="filerow__edit">
                        <label className="visually-hidden" htmlFor={`${id}-latex`}>
                          LaTeX source
                        </label>
                        <textarea
                          id={`${id}-latex`}
                          className="wrap__input wrap__source"
                          rows={4}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                        <div className="filerow__acts">
                          <button
                            className="btn btn-sm"
                            type="button"
                            aria-label="Save the reading"
                            onClick={() => saveReading(photo, draft)}
                            disabled={editReading.isPending}
                          >
                            Save
                          </button>
                          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <LatexView
                        key={photo.id}
                        latex={tex.extractedText}
                        onEdit={(latex) => {
                          setDraft(latex);
                          setEditing(photo.id);
                        }}
                        onRetry={() => retryReading.mutate(photo.id)}
                      />
                    ))}
                </li>
              );
            })}
            {others.map((file) => (
              <li key={file.id} className="filerow">
                <a className="filerow__name" href={file.url} target="_blank" rel="noreferrer">
                  {file.filename}
                </a>
                <span className="filerow__status">{kindWord(file.kind)}</span>
              </li>
            ))}
          </ul>
        )}
        {shown.length > 0 && (
          <p className="wrap__count num">
            {shown.length} {shown.length === 1 ? 'file' : 'files'}
          </p>
        )}

        <div className="wrap__foot">
          <button
            className="btn"
            type="button"
            onClick={() => {
              // A name or note still in a focused field saves before the sheet closes.
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              onClose();
            }}
          >
            Save
          </button>
          <span className="wrap__hint">Files save as they land; this closes the sheet.</span>
        </div>
      </div>
    </Sheet>
  );
}

function photoStatus(photo: Attachment): string {
  const what = photo.kind === 'pdf' ? 'PDF' : 'photo';
  if (photo.visionStatus === 'pending') return 'Reading…';
  if (photo.visionStatus === 'failed') {
    switch (photo.visionError) {
      case 'balance':
        return 'Waiting for Claude: the gateway is out of balance. Top it up and this reads by itself.';
      case 'unreachable':
        return 'Couldn’t reach Claude. Trying again by itself.';
      case 'auth':
        return 'The Claude gateway refused the hub’s token. Check it in Settings, then retry.';
      case 'model':
        return 'The Claude model isn’t on the gateway. Check it in Settings, then retry.';
      case 'setup':
        return 'Claude isn’t set up yet. Set it up in Settings, then retry.';
      default:
        return `Couldn’t read this ${what} — retry`;
    }
  }
  if (photo.visionStatus === 'done') return 'Read';
  return photo.kind === 'pdf' ? 'PDF' : 'Photo';
}

function kindWord(kind: Attachment['kind']): string {
  if (kind === 'pdf') return 'PDF';
  if (kind === 'code') return 'Code';
  if (kind === 'text') return 'Text';
  return 'File';
}
