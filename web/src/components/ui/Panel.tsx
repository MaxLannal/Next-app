import { useId, type ReactNode } from 'react';

type PanelProps = {
  title: string;
  /** Controls in the head, right of the title: tabs, a ghost pill, a menu. */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/** One glass surface with its lit edge. Never put a Panel inside another glass surface. */
export function Panel({ title, actions, className, children }: PanelProps) {
  const titleId = useId();
  return (
    <section className={className ? `glass panel ${className}` : 'glass panel'} aria-labelledby={titleId}>
      <header className="panel__head">
        <h2 className="panel__title" id={titleId}>
          {title}
        </h2>
        {actions !== undefined && <div className="panel__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
