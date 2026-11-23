// The hub's display formats, in one place. Times and dates are shown in the
// browser's time zone, which on the Mac is the hub's.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');
const wholeSeconds = (s: number) => (Number.isFinite(s) && s > 0 ? Math.floor(s) : 0);

/** `"0 m"`, `"<1 m"` for 1–59 s, `"45 m"`, `"1 h 25 m"`. */
export function formatDuration(s: number): string {
  const total = wholeSeconds(s);
  if (total > 0 && total < 60) return '<1 m';
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} m`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

/** A share of a whole as `"75%"`; a sliver shows as `"<1%"`, never `"0%"`. */
export function formatShare(share: number): string {
  const pct = Number.isFinite(share) ? Math.round(share * 100) : 0;
  return pct === 0 && share > 0 ? '<1%' : `${pct}%`;
}

/** A running clock: `"00:42:10"`. Hours keep counting past 24. */
export function formatClock(s: number): string {
  const total = wholeSeconds(s);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

/** 24-hour local time: `"14:02"`. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A file size: `"812 B"`, `"14 KB"`, `"1.4 MB"`. */
export function sizeOf(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** `"Sun 22 Nov"`. A day key (`2026-11-22`) is that calendar day; an instant is its local day. */
export function formatShortDate(dayKeyOrIso: string): string {
  const key = DAY_KEY.exec(dayKeyOrIso);
  const d = key ? new Date(Number(key[1]), Number(key[2]) - 1, Number(key[3])) : new Date(dayKeyOrIso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
