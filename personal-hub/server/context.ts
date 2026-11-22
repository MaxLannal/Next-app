import type Anthropic from '@anthropic-ai/sdk';
import type { Context } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type { CalendarEvent, GitStatus, ImageReading, NowPlaying } from '../shared/types.ts';
import type { ConfigStore } from './config.ts';
import type { HubPaths } from './paths.ts';
import type { JobQueue } from './services/jobs.ts';

/** A service the hub can't reach right now (not set up, no permission, gateway down). */
export class UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnavailableError';
  }
}

export type ClaudeClient = {
  readImage(img: { data: Buffer; mediaType: 'image/jpeg' }): Promise<ImageReading>;
  streamTurn(
    p: { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[]; signal?: AbortSignal },
    onText: (delta: string) => void,
  ): Promise<Anthropic.Message>;
};

export type MacBridge = {
  calendarEvents(from: Date, to: Date): Promise<{ events: CalendarEvent[]; source: 'eventkit' | 'calendar-app' }>;
  calendarStatus(): Promise<'granted' | 'denied' | 'missing'>;
  convertImage(src: string, dest: string, maxPixels: number): Promise<void>;
  mediaKey(key: 'play' | 'next' | 'previous'): Promise<void>;
  nowPlaying(): Promise<NowPlaying | null>;
  mediaStatus(): Promise<'ready' | 'no-accessibility' | 'missing'>;
  keepAwake(on: boolean): void;
};

export type GitSync = {
  status(): GitStatus;
  enqueuePush(attachmentId: number): void;
  pull(): Promise<GitStatus>;
  connect(repo: string): Promise<GitStatus>;
};

export type AppContext = {
  db: DatabaseSync;
  paths: HubPaths;
  config: ConfigStore;
  now(): Date;
  timeZone(): string;
  remoteAddress(c: Context): string;
  jobs: JobQueue;
  claude: ClaudeClient;
  mac: MacBridge;
  git: GitSync;
};

// Stand-ins for services that aren't set up. Each method fails with UnavailableError,
// except the status reads, which report "not set up", and keepAwake, which does nothing.

const claudeUnavailable = () => new UnavailableError('Claude is not set up yet');
export const unavailableClaude: ClaudeClient = {
  readImage: async () => {
    throw claudeUnavailable();
  },
  streamTurn: async () => {
    throw claudeUnavailable();
  },
};

const macUnavailable = () => new UnavailableError('Mac helpers are not set up yet');
export const unavailableMac: MacBridge = {
  calendarEvents: async () => {
    throw macUnavailable();
  },
  calendarStatus: async () => 'missing',
  convertImage: async () => {
    throw macUnavailable();
  },
  mediaKey: async () => {
    throw macUnavailable();
  },
  nowPlaying: async () => {
    throw macUnavailable();
  },
  mediaStatus: async () => 'missing',
  keepAwake: () => {},
};

const gitUnavailable = () => new UnavailableError('GitHub sync is not set up yet');
export const unavailableGit: GitSync = {
  status: () => ({ configured: false, repo: null, lastSyncAt: null, lastError: null, pending: 0 }),
  enqueuePush: () => {
    throw gitUnavailable();
  },
  pull: async () => {
    throw gitUnavailable();
  },
  connect: async () => {
    throw gitUnavailable();
  },
};
