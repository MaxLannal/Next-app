// Types that cross the wire between the server and the web app.

export type AttachmentKind = 'image' | 'pdf' | 'code' | 'text' | 'latex' | 'other';

export type ImageReading = { kind: 'latex'; latex: string } | { kind: 'caption'; caption: string };

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  color: string;
  location: string | null;
  notes: string | null;
  url: string | null;
};

export type NowPlaying = {
  title: string;
  artist: string;
  album: string | null;
  artwork: string | null;
  playing: boolean;
};

export type GitStatus = {
  configured: boolean;
  repo: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  pending: number;
};

/** Focus time for one subject. `name` is `'No subject'` when `subjectId` is null. */
export type SubjectSlice = {
  subjectId: number | null;
  name: string;
  seconds: number;
};

/** One day of the year-of-focus heatmap. `level` 0 is no focus; 1–5 are the sage steps. */
export type HeatmapDay = {
  date: string;
  seconds: number;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  subjects: SubjectSlice[];
};
