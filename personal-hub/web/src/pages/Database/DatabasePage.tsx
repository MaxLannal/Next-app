import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { Attachment, FocusSession } from '@shared/types.ts';
import { api, ApiError } from '../../api.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { sizeOf } from '../../lib/format.ts';
import { countActive, Filters, scopeOf } from './Filters.tsx';
import type { GroupBy } from './groupSessions.ts';
import { readView, sessionsPath, toSessionFilters, writeView, type FilterState } from './params.ts';
import { SessionDetail } from './SessionDetail.tsx';
import { SessionList } from './SessionList.tsx';
import type { SortKey } from './types.ts';
import './database.css';

/**
 * The Database: filters on the left, sessions in the middle, and the chat sidebar's
 * place on the right. `/database` lists (with every filter in the address bar) and
 * `/database/session/:id` opens one session, with the chat still beside it.
 */
export function DatabasePage() {
  return (
    <div className="container page db">
      <header className="db__head">
        <h1 className="db__title">Database</h1>
        <p className="db__lead">Every focus session with its notes, photos and files.</p>
      </header>
      <div className="db__grid db__grid--list">
        <DatabaseList />
        <ChatSlot />
      </div>
    </div>
  );
}

/** One session, at `/database/session/:id`, with the chat's place kept beside it on wide screens. */
export function SessionPage() {
  return (
    <div className="container page db">
      <h1 className="visually-hidden">Session</h1>
      <div className="db__grid db__grid--detail">
        <SessionDetail />
        <ChatSlot />
      </div>
    </div>
  );
}

/** Where Task 20 puts the chat sidebar. It is not built here. */
function ChatSlot() {
  return <aside className="db__chat-slot" aria-label="Chat" />;
}

/**
 * The list half: filters and the middle column. The search filters as it is typed (the
 * address bar is replaced, not pushed); the other filters count what the scope holds.
 */
function DatabaseList() {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readView(params), [params]);
  const { filters, sort, group } = view;

  const update = (next: Partial<{ filters: FilterState; sort: SortKey; group: GroupBy }>) => {
    const written = writeView({ filters: next.filters ?? filters, sort: next.sort ?? sort, group: next.group ?? group });
    setParams(written, { replace: true });
  };

  const list = useQuery({
    queryKey: ['sessions', 'database', sessionsPath(view)],
    queryFn: ({ signal }) => api<FocusSession[]>(sessionsPath(view), { signal }),
  });

  // The tag counts ride on every other filter, so a kind or source narrows them too.
  // That query is the same shape all afternoon, so it is fetched once and kept.
  const scoped = useMemo(() => ({ ...filters, q: '', tags: [] }), [filters]);
  const scopeQuery = useQuery({
    queryKey: ['sessions', 'scope', JSON.stringify(toSessionFilters(scoped, false))],
    queryFn: ({ signal }) => api<FocusSession[]>(sessionsPath({ filters: scoped, sort: 'created' }), { signal }),
    staleTime: 5 * 60_000,
  });
  const scope = useMemo(() => scopeOf(scopeQuery.data ?? list.data ?? [], scoped, null), [scopeQuery.data, list.data, scoped]);

  return (
    <>
      <div className="db__filters">
        <Filters value={filters} onChange={(next) => update({ filters: next })} scope={scope} />
      </div>
      <div className="db__list">
        <GitHubSlot />
        {list.isError ? (
          <EmptyState
            title="Couldn’t load the sessions"
            line={list.error instanceof ApiError && list.error.status !== 0 ? list.error.message : 'The hub didn’t answer.'}
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void list.refetch()}>
                Retry
              </button>
            }
          />
        ) : list.data === undefined ? (
          <p className="db__note">Loading sessions…</p>
        ) : countActive(filters) === 0 && list.data.length === 0 ? (
          <EmptyState title="No sessions yet" line="Start a focus session and it lands here, with its notes and files." />
        ) : (
          <SessionList
            sessions={list.data}
            sort={sort}
            group={group}
            onSort={(next) => update({ sort: next })}
            onGroup={(next) => update({ group: next })}
          />
        )}
        <FromGitHub />
      </div>
    </>
  );
}

/**
 * Task 19 slot: the GitHub status line ("Last synced 14:02 · push failed — retry")
 * and its sync controls. Empty until the sync routes exist; nothing here calls them.
 */
function GitHubSlot() {
  return <div className="db__github-slot" data-slot="github-status" />;
}

/**
 * Files that came from the repository but belong to no session, as one group under
 * the sessions. Empty, and quiet, until a file arrives that way.
 */
function FromGitHub() {
  const query = useQuery({
    queryKey: ['attachments', 'unfiled', 'github'],
    queryFn: ({ signal }) => api<Attachment[]>('/api/attachments?unfiled=1&source=github', { signal }),
  });
  const files = query.data ?? [];
  if (query.isError || files.length === 0) return null;

  const groups = new Map<string, Attachment[]>();
  for (const file of files) {
    const folder = file.repoPath?.includes('/') ? (file.repoPath.split('/')[0] ?? '') : '';
    const list = groups.get(folder) ?? [];
    list.push(file);
    groups.set(folder, list);
  }

  return (
    <section className="db-group db-github" aria-label="From GitHub">
      <header className="db-group__head">
        <h3 className="db-group__title">From GitHub</h3>
        <p className="db-group__meta num">
          {files.length} {files.length === 1 ? 'file' : 'files'} · no session
        </p>
      </header>
      <ul className="db-gh-files">
        {[...groups].map(([folder, list]) => (
          <li key={folder === '' ? '—' : folder}>
            <p className="db-gh-files__folder">{folder === '' ? 'Repository root' : folder}</p>
            <ul>
              {list.map((file) => (
                <li className="db-gh-file" key={file.id}>
                  <a href={file.url} download={file.filename}>
                    {file.filename}
                  </a>
                  <span className="db-gh-file__meta num">{sizeOf(file.size)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
