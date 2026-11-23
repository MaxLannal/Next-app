import type { Attachment } from '@shared/types.ts';

/**
 * Where a file stands with GitHub, from the row alone. Nothing here calls Task 19's
 * endpoints: the state is whatever the last sync wrote to the attachment.
 *
 * Task 19 slot: the status line ("Last synced 14:02 · push failed — retry") belongs in
 * the page header (see `githubSlot` in DatabasePage). This badge reads `repoState`
 * only; wire its retry to the sync endpoint when that route lands.
 */
export function GitHubFileBadge({ file }: { file: Attachment }) {
  if (file.source === 'github') {
    return (
      <span className="gh-badge" title={file.repoPath ?? undefined}>
        From GitHub
      </span>
    );
  }
  if (file.repoState === 'removed') return <span className="gh-badge is-apricot">Removed on GitHub</span>;
  if (file.repoState === 'failed') return <span className="gh-badge is-apricot">Push failed</span>;
  if (file.repoState === 'synced') return <span className="gh-badge">On GitHub</span>;
  // Not in the repo: photos and PDFs stay local, and code waits for its first push.
  return null;
}
