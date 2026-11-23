import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Subject } from '@shared/types.ts';
import { ApiError } from '../../../api.ts';
import type { SessionActions, SessionGoal } from './useSessions.ts';
import './focus.css';

type StartFormProps = {
  subjects: Subject[];
  goals: SessionGoal[];
  actions: SessionActions;
  /** A session is already open, so nothing can start. */
  busy: boolean;
};

/**
 * Name (needed), the subject it is about (pick one or type a new name), its
 * tags (comma or Enter makes a chip) and its goal. Enter starts.
 */
export function StartForm({ subjects, goals, actions, busy }: StartFormProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const tagsRef = useRef<HTMLInputElement>(null);

  const ready = name.trim() !== '' && !busy && !starting;

  /** The chips made so far, then the draft, without repeats. */
  const chips = () => {
    const all = [...tags, draft].map((t) => t.trim()).filter((t) => t !== '');
    return [...new Set(all)];
  };

  const onTagsKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter in the tags field makes a chip, not a start; comma closes one too.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft.trim() !== '') {
        setTags(chips());
        setDraft('');
      }
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      setTags((ts) => ts.slice(0, -1));
    }
  };

  const submit = async () => {
    if (!ready) return;
    setError(null);
    setStarting(true);
    try {
      await actions.start({
        name: name.trim(),
        ...(subject.trim() !== '' ? { subjectName: subject.trim() } : {}),
        ...(tags.length > 0 || draft.trim() !== '' ? { tags: chips() } : {}),
        ...(goal !== '' ? { goalId: Number(goal) } : {}),
      });
      setName('');
      setSubject('');
      setTags([]);
      setDraft('');
      setGoal('');
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Couldn’t start — retry');
    } finally {
      setStarting(false);
    }
  };

  return (
    <form
      className="start"
      aria-label="Start a focus session"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="start__row">
        <label className="start__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <div className="start__main">
          <input
            id={`${id}-name`}
            className="start__field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What are you working on?"
            autoComplete="off"
          />
          <button className="btn" type="submit" disabled={!ready}>
            Start
          </button>
        </div>
      </div>

      <div className="start__meta">
        <div className="start__cell">
          <label className="start__label" htmlFor={`${id}-subject`}>
            Subject
          </label>
          <input
            id={`${id}-subject`}
            className="start__field start__field--sm"
            list={`${id}-subjects`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Pick one or type a new name"
            autoComplete="off"
          />
          <datalist id={`${id}-subjects`}>
            {subjects.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </div>

        <div className="start__cell start__cell--tags">
          <label className="start__label" htmlFor={`${id}-tags`}>
            Tags
          </label>
          <div className="start__chips" onClick={() => tagsRef.current?.focus()}>
            {tags.map((tag) => (
              <span key={tag} className="chip">
                {tag}
                <button
                  type="button"
                  className="chip__drop"
                  aria-label={`Drop ${tag}`}
                  onClick={() => setTags((ts) => ts.filter((t) => t !== tag))}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              id={`${id}-tags`}
              ref={tagsRef}
              className="start__field start__field--ghost"
              value={draft}
              onChange={(e) => {
                const value = e.target.value;
                // A comma closes the chip it follows.
                if (value.includes(',')) {
                  const [head, ...rest] = value.split(',');
                  setTags((ts) => (head.trim() !== '' ? [...new Set([...ts, head.trim()])] : ts));
                  setDraft(rest.join(','));
                } else {
                  setDraft(value);
                }
              }}
              onKeyDown={onTagsKey}
              onBlur={() => {
                if (draft.trim() !== '') {
                  setTags(chips());
                  setDraft('');
                }
              }}
              placeholder={tags.length === 0 ? 'Papers, reading' : ''}
              autoComplete="off"
            />
          </div>
        </div>

        {goals.length > 0 && (
          <div className="start__cell">
            <label className="start__label" htmlFor={`${id}-goal`}>
              Goal
            </label>
            <select
              id={`${id}-goal`}
              className="start__field start__field--sm"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            >
              <option value="">No goal</option>
              {goals.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {busy && <p className="start__note">One session at a time — stop this one to start another.</p>}
      {error !== null && (
        <p className="start__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
