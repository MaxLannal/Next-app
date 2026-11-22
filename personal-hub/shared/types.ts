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

// --- Task 13 ---

export type ResourceKind = 'pdf' | 'video' | 'course' | 'link';

export type Resource = {
  id: number;
  url: string;
  title: string;
  kind: ResourceKind;
  /** The host without a leading `www.`, e.g. "coursera.org". */
  domain: string;
  thumbnail: string | null;
  note: string;
  done: boolean;
  createdAt: string;
};
