import { useState, type ReactNode } from 'react';

/**
 * A resource's site icon (YouTube's red one for a YouTube video), as the hub keeps it; until it
 * loads, or when the site has none, `fallback` stands in.
 */
export function SiteIcon({ resourceId, fallback, className = 'site-icon' }: { resourceId: number; fallback: ReactNode; className?: string }) {
  const [state, setState] = useState<'loading' | 'shown' | 'none'>('loading');
  return (
    <>
      {state !== 'shown' && fallback}
      {state !== 'none' && (
        <img
          className={className}
          src={`/api/resources/${resourceId}/icon`}
          alt=""
          draggable={false}
          hidden={state !== 'shown'}
          onLoad={() => setState('shown')}
          onError={() => setState('none')}
        />
      )}
    </>
  );
}
