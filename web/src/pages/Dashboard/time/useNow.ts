import { useEffect, useState } from 'react';

/**
 * The current time, refreshed on each whole `stepMs` (a second, a minute), so a
 * clock turns over with the system clock instead of drifting against it.
 */
export function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, stepMs - (Date.now() % stepMs));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [stepMs]);

  return now;
}
