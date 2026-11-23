// Dates as an iPhone Shortcut writes them, in whatever language the phone is set to. An ISO
// instant with an offset is taken as it is; a wall-clock date (Chinese, English, or ISO without an
// offset) is read in the hub time zone.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const HOUR_MS = 3_600_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock at instant `t` in `tz`, written as if it were UTC (whole seconds). */
function wallOf(t: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of formatterFor(tz).formatToParts(new Date(t))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * The instant whose wall clock in `tz` reads the given fields. On a repeated hour (DST ending) the
 * first occurrence; on a skipped hour (DST starting) the instant just after the gap. Null when the
 * fields aren't a real date or time.
 */
export function zonedInstant(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(wall).getUTCDate() !== d) return null; // 31 Nov and the like
  const offsetAround = (t: number) => wallOf(t, tz) - Math.floor(t / 1000) * 1000;
  const before = wall - offsetAround(wall - 12 * HOUR_MS);
  const after = wall - offsetAround(wall + 12 * HOUR_MS);
  const exact = [before, after].filter((t) => wallOf(t, tz) === wall).sort((a, b) => a - b);
  return new Date(exact[0] ?? before);
}

/** A 12-hour clock with its marker → 0–23. No marker means the hour is already 24-hour. */
function to24(hour: number, marker: string | undefined): number {
  if (!marker) return hour;
  const m = marker.replace(/\./g, '').toUpperCase();
  if (m === 'AM' || m === '上午' || m === '凌晨' || m === '早上') return hour === 12 ? 0 : hour;
  if (m === 'PM' || m === '下午' || m === '晚上') return hour < 12 ? hour + 12 : hour;
  if (m === '中午') return hour >= 11 ? hour : hour + 12;
  return hour;
}

const monthFrom = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** One Shortcut date → an instant, or null when the text isn't a date this reader knows. */
export function parseShortcutDate(text: string, tz: string): Date | null {
  const s = text.trim();
  if (s === '') return null;
  let m: RegExpMatchArray | null;

  // An instant with an offset or Z: exactly what it says.
  m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})$/i);
  if (m) {
    const offset = m[3].toUpperCase() === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const time = m[2].length === 4 ? `0${m[2]}` : m[2];
    const ms = Date.parse(`${m[1]}T${time}${offset}`);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }

  // ISO without an offset: a wall clock.
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return zonedInstant(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), tz);

  // Chinese: 2026年11月22日 上午5:40, 2026年11月22日 23:05, 2026/11/22 05:40:12.
  m = s.match(
    /^(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?\s*(?:(?:星期|周|週)\S)?\s*(凌晨|早上|上午|中午|下午|晚上|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (m) return zonedInstant(+m[1], +m[2], +m[3], to24(+m[5], m[4] ?? m[8]), +m[6], +(m[7] ?? 0), tz);

  // English, month first: Nov 22, 2026 at 5:40 AM; November 22, 2026, 12:10 AM.
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]\.?M\.?)?$/i);
  if (m && monthFrom(m[1]) > 0) return zonedInstant(+m[3], monthFrom(m[1]), +m[2], to24(+m[4], m[7]), +m[5], +(m[6] ?? 0), tz);

  // English, day first: 22 Nov 2026 at 05:40.
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]\.?M\.?)?$/i);
  if (m && monthFrom(m[2]) > 0) return zonedInstant(+m[3], monthFrom(m[2]), +m[1], to24(+m[4], m[7]), +m[5], +(m[6] ?? 0), tz);

  return null;
}
