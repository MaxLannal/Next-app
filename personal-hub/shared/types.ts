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

// --- Task 14 ---

export type CalendarSource = 'eventkit' | 'calendar-app';

/** `GET /api/calendar?from&to`. When the Mac refuses calendar access it answers 503 with `ServiceFix`. */
export type CalendarResponse = { events: CalendarEvent[]; source: CalendarSource };

/** A 503 body: what is wrong and the one step that fixes it. */
export type ServiceFix = { error: string; fix: string };
