import type { Trace, TracePhoto } from '@shared/types.ts';
import { formatDayKey } from '../../lib/format.ts';

/** A city's experiences together: one pin on the globe, one album in the sidebar. */
export type City = {
  key: string;
  city: string;
  country: string;
  /** Its experiences in the order they happened, oldest first. */
  traces: Trace[];
  /** Where its pin goes: the middle of its experiences. */
  lng: number;
  lat: number;
  /** Every photo from it, the latest experience's first. */
  photos: TracePhoto[];
  /** "28 Sep – 23 Nov 2026", the one day, or '' when none is dated. */
  when: string;
};

const norm = (s: string) => s.trim().toLocaleLowerCase();

/** Experiences in the same city and country share a key; one with no city stands on its own. */
export const cityKey = (t: Pick<Trace, 'id' | 'city' | 'country'>) => (t.city.trim() === '' ? `#${t.id}` : `${norm(t.city)}|${norm(t.country)}`);

/** When an experience happened, for ordering: its day, else the day it was pinned. */
const dayOf = (t: Trace) => t.day ?? t.createdAt.slice(0, 10);

/** The days as one span: "28 Sep – 23 Nov 2026", the year said once when both share it. */
export function spanOf(days: readonly string[]): string {
  if (days.length === 0) return '';
  const sorted = [...days].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first === last) return formatDayKey(first);
  const from = formatDayKey(first);
  return `${first.slice(0, 4) === last.slice(0, 4) ? from.replace(/\s\d{4}$/, '') : from} – ${formatDayKey(last)}`;
}

/** The traces gathered by city, the city visited most recently first. */
export function groupByCity(traces: readonly Trace[]): City[] {
  const groups = new Map<string, Trace[]>();
  for (const t of traces) groups.set(cityKey(t), [...(groups.get(cityKey(t)) ?? []), t]);
  const cities = [...groups].map(([key, list]): City => {
    const visits = [...list].sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.id - b.id);
    const latest = visits[visits.length - 1]!;
    return {
      key,
      city: latest.city,
      country: latest.country,
      traces: visits,
      lng: visits.reduce((sum, t) => sum + t.lng, 0) / visits.length,
      lat: visits.reduce((sum, t) => sum + t.lat, 0) / visits.length,
      photos: [...visits].reverse().flatMap((t) => t.photos),
      when: spanOf(visits.flatMap((t) => (t.day === null ? [] : [t.day]))),
    };
  });
  return cities.sort((a, b) => dayOf(b.traces[b.traces.length - 1]!).localeCompare(dayOf(a.traces[a.traces.length - 1]!)));
}
