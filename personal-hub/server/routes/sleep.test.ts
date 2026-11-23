import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SleepNight, SleepSample, SleepStage } from '../../shared/types.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

const ISO = (d: Date) => d.toISOString();

/**
 * One night from 23:00 local on 21 Nov (05:00Z on 22 Nov, CST) to 07:00 local on 22 Nov.
 * Each run starts where the last ended.
 */
function nightRuns(source: string, runs: [number, SleepStage][]): SleepSample[] {
  const d0 = Date.parse('2026-11-22T05:00:00.000Z');
  const m = 60_000;
  let t = 0;
  return runs.map(([minutes, stage]) => {
    const sample = { start: ISO(new Date(d0 + t * m)), end: ISO(new Date(d0 + (t + minutes) * m)), stage, source };
    t += minutes;
    return sample;
  });
}

/** in_bed, awake, core, deep, rem: asleep 4 h 30 m in 8 h, score 96 (the brief's full night). */
const FULL: [number, SleepStage][] = [
  [480, 'in_bed'],
  [30, 'awake'],
  [240, 'core'],
  [90, 'deep'],
  [120, 'rem'],
];

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

type IngestReply = { inserted: number; nights: number };
type SleepReply = { nights: SleepNight[]; lastNight: SleepNight | null; lastSyncAt: string | null };

const postSleep = (body: unknown, init?: Parameters<TestContext['req']>[3]) => t.req('POST', '/api/ingest/sleep', body, init);
const getSleep = async (query = ''): Promise<SleepReply> => {
  const res = await t.req('GET', `/api/sleep${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as SleepReply;
};

describe('POST /api/ingest/sleep', () => {
  it('ingest is idempotent', async () => {
    // 10 samples, re-sent twice: a Watch night and an overlapping iPhone window of the same night.
    const watch = nightRuns("My Apple Watch", FULL);
    const phone = nightRuns('iPhone', [
      [480, 'in_bed'],
      [240, 'core'],
      [90, 'deep'],
      [120, 'rem'],
      [30, 'awake'],
    ]);
    const payload = { samples: [...watch, ...phone] };
    expect(payload.samples).toHaveLength(10);

    const first = await postSleep(payload);
    expect(first.status).toBe(200);
    expect(((await first.json()) as IngestReply).inserted).toBe(10);
    const before = await getSleep();

    // The Shortcut re-sends the same 7-day window; the rows are identical, so none is new.
    const second = await postSleep(payload);
    expect(second.status).toBe(200);
    expect(((await second.json()) as IngestReply).inserted).toBe(0);

    const after = await getSleep();
    expect(after.nights).toEqual(before.nights);
    expect(after.nights).toHaveLength(1);
    expect(after.nights[0].asleepSeconds).toBe(27000);
  });

  it('prefers the Watch source', async () => {
    // The Watch saw 7 h asleep; the iPhone, lying on the bed, claims 8 h of the same night.
    const watch = nightRuns("My Apple Watch", [[420, 'core']]);
    const phone = nightRuns('iPhone', [[480, 'core']]);
    await postSleep({ samples: [...phone, ...watch] });
    const body = await getSleep();
    expect(body.nights).toHaveLength(1);
    expect(body.nights[0].asleepSeconds).toBe(7 * 3600);
    expect(body.nights[0].source).toContain('Watch');
    // The iPhone's samples are stored too, so they come back in order; the night still counts the Watch.
    const { n } = t.db.prepare('SELECT COUNT(*) AS n FROM sleep_samples').get() as { n: number };
    expect(n).toBe(2);
  });

  it('counts overlapping windows from one source once', async () => {
    const wide = { start: '2026-11-22T05:00:00.000Z', end: '2026-11-22T13:00:00.000Z', stage: 'core' as const, source: 'Watch' };
    const narrow = { start: '2026-11-22T07:00:00.000Z', end: '2026-11-22T09:00:00.000Z', stage: 'awake' as const, source: 'Watch' };
    await postSleep({ samples: [wide, narrow] });
    const body = await getSleep();
    expect(body.nights[0].asleepSeconds).toBe(8 * 3600);
    expect(body.nights[0].stages.awake).toBe(0);
  });

  it('accepts a text payload', async () => {
    const text = [
      '2026-11-21T23:14:05-06:00;2026-11-22T03:14:05-06:00;Core;My Apple Watch',
      '2026-11-22T03:14:05-06:00;2026-11-22T05:14:05-06:00;REM;My Apple Watch',
    ].join('\n');
    const res = await postSleep(text, { headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(200);
    const reply = (await res.json()) as IngestReply;
    expect(reply).toMatchObject({ inserted: 2, nights: 1 });
    const [night] = (await getSleep()).nights;
    expect(night.stages.core).toBe(4 * 3600);
    expect(night.stages.rem).toBe(2 * 3600);
  });

  it('token required from remote', async () => {
    const remote = { remote: '10.0.0.5', headers: { host: 'hub.local:4747' } };
    expect((await postSleep({ samples: nightRuns('Watch', FULL) }, remote)).status).toBe(401);
    const token = t.config.get().hubToken;
    const res = await postSleep({ samples: nightRuns('Watch', FULL) }, {
      ...remote,
      headers: { ...remote.headers, authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('refuses a malformed payload', async () => {
    const res = await postSleep({ samples: [{ start: 'soon', end: 'later', stage: 'core', source: 'Watch' }] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ingest/health-export', () => {
  const fixture = readFileSync(fileURLToPath(new URL('../test/fixtures/export-sample.xml', import.meta.url)));

  const form = (content: string | Uint8Array, filename: string) => {
    const body = new FormData();
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    body.append('file', new File([new Uint8Array(bytes)], filename));
    return body;
  };

  it('imports an xml export, once', async () => {
    const res = await t.req('POST', '/api/ingest/health-export', form(fixture, 'export.xml'));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { inserted: number }).inserted).toBe(2);
    const again = await t.req('POST', '/api/ingest/health-export', form(fixture, 'export.xml'));
    expect(((await again.json()) as { inserted: number }).inserted).toBe(0);
  });

  it('refuses a file that is not xml or zip', async () => {
    const res = await t.req('POST', '/api/ingest/health-export', form('hello', 'notes.txt'));
    expect(res.status).toBe(400);
  });

  it('token required from remote', async () => {
    const res = await t.req('POST', '/api/ingest/health-export', form(fixture, 'export.xml'), {
      remote: '10.0.0.5',
      headers: { host: 'hub.local:4747' },
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/sleep', () => {
  it('reports no data calmly', async () => {
    expect(await getSleep()).toEqual({ nights: [], lastNight: null, lastSyncAt: null });
  });

  it('returns the last 14 nights by default and honours ?nights', async () => {
    const samples = Array.from({ length: 20 }, (_, i) => {
      const d0 = Date.parse('2026-10-01T05:00:00.000Z') + i * 86_400_000;
      return { start: ISO(new Date(d0)), end: ISO(new Date(d0 + 7 * 3_600_000)), stage: 'core' as const, source: 'Watch' };
    });
    await postSleep({ samples });
    const all = (await getSleep('?nights=30')).nights;
    expect(all).toHaveLength(20);
    expect((await getSleep()).nights).toHaveLength(14);
    const body = await getSleep();
    expect(body.lastNight?.night).toBe('2026-10-20');
    expect(body.lastSyncAt).not.toBeNull();
  });

  it('rejects a bad nights value', async () => {
    expect((await t.req('GET', '/api/sleep?nights=zero')).status).toBe(400);
    expect((await t.req('GET', '/api/sleep?nights=400')).status).toBe(400);
  });
});
