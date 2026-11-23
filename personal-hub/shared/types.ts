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

// --- Task 6 ---

/** A stored file. `url` serves the original; `previewUrl` is set once a HEIC/HEIF preview exists. */
export type Attachment = {
  id: number;
  sessionId: number | null;
  parentId: number | null;
  kind: AttachmentKind;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  source: 'upload' | 'github';
  extractedText: string;
  visionStatus: 'pending' | 'done' | 'failed' | null;
  repoPath: string | null;
  repoState: 'pending' | 'synced' | 'failed' | 'removed' | null;
  url: string;
  previewUrl: string | null;
};

export type SearchKind = 'session' | 'essay' | 'attachment';

/** One full-text match. `snippet` is plain text around the match. */
export type SearchHit = {
  kind: SearchKind;
  refId: number;
  title: string;
  snippet: string;
};
// --- Task 4 ---

/** One timer change. A session is stored as these events, so queued ones can be replayed later. */
export type SessionEvent = { type: 'start' | 'pause' | 'resume' | 'stop'; at: string };
// --- Task 14 ---

export type CalendarSource = 'eventkit' | 'calendar-app';

/** `GET /api/calendar?from&to`. When the Mac refuses calendar access it answers 503 with `ServiceFix`. */
export type CalendarResponse = { events: CalendarEvent[]; source: CalendarSource };

/** A 503 body: what is wrong and the one step that fixes it. */
export type ServiceFix = { error: string; fix: string };

// --- Task 11 ---

export type ExerciseKind = 'pushups' | 'squats';

/** One kind's exercise numbers for a range: its buckets, their total and the daily average. */
export type ExerciseSeries = {
  buckets: { label: string; value: number }[];
  total: number;
  dailyAverage: number;
};

/** `GET /api/exercise`: today's counts, then a series per requested kind. */
export type ExerciseReply = {
  today: Record<ExerciseKind, number>;
  series: Partial<Record<ExerciseKind, ExerciseSeries>>;
};

// --- Task 16 ---

/** The three essays columns, in page order. */
export type EssayColumn = 'meditations' | 'plans' | 'insights';

/** An essay in the column list. `firstLine` is its first non-empty line of text. */
export type EssaySummary = {
  id: number;
  column: EssayColumn;
  title: string;
  firstLine: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
};

/** One essay, with its document. */
export type Essay = EssaySummary & { contentJson: unknown };
