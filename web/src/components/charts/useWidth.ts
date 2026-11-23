import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The width of the element behind `ref`, kept current with a ResizeObserver,
 * so charts can lay marks out in real pixels (bars stay ≤ 24 px, gaps 2–4 px)
 * instead of stretching a viewBox. Until there is a measurement (or where
 * there is no layout at all, as in jsdom) it is `fallback`.
 */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
