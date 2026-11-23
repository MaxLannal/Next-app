import type { ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  /** One calm line: what is missing, or what to do first. */
  line: string;
  action?: ReactNode;
};

/** What a panel shows before it has data. Never sample figures. */
export function EmptyState({ title, line, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__line">{line}</p>
      {action !== undefined && <div className="empty__action">{action}</div>}
    </div>
  );
}
