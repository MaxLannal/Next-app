import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
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

/** A stored (uncompressed) zip of `files`, as Health's "Export All Health Data" makes one. */
function zipOf(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

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

  it('adds only the new samples when the next day re-sends an overlapping window', async () => {
    // Day one: the 7-day window ending with the night of the 22nd.
    const base = nightRuns('Watch', FULL);
    await postSleep({ samples: base });
    const before = await getSleep();
    expect(before.nights).toHaveLength(1);

    // Day two: the same window plus two samples for the next night, each starting where the last ends.
    const nextNight = [
      { start: '2026-11-23T04:00:00.000Z', end: '2026-11-23T09:00:00.000Z', stage: 'core' as SleepStage, source: 'Watch' },
      { start: '2026-11-23T09:00:00.000Z', end: '2026-11-23T12:00:00.000Z', stage: 'deep' as SleepStage, source: 'Watch' },
    ];
    const res = await postSleep({ samples: [...base, ...nextNight] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as IngestReply).inserted).toBe(2);

    const after = await getSleep();
    // The older night is untouched: no minutes were added twice.
    expect(after.nights.find((n) => n.night === '2026-11-22')).toEqual(before.nights[0]);
    // The new samples are one night of their own, ending on the 23rd.
    const fresh = after.nights.find((n) => n.night === '2026-11-23');
    expect(fresh?.asleepSeconds).toBe(8 * 3600);
    expect(fresh?.stages.core).toBe(5 * 3600);
    expect(fresh?.stages.deep).toBe(3 * 3600);
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

  it('imports the export.xml inside the zip Health makes', async () => {
    const zip = await zipOf({ 'apple_health_export/export.xml': Buffer.from(fixture) });
    const res = await t.req('POST', '/api/ingest/health-export', form(zip, 'export.zip'));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { inserted: number }).inserted).toBe(2);
    const noche = await t.req('POST', '/api/ingest/health-export', form(await zipOf({ 'readme.txt': Buffer.from('hi') }), 'other.zip'));
    expect(noche.status).toBe(400);
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
    expect(await getSleep()).toEqual({ nights: [], lastNight: null, lastSyncAt: null, lastIngest: null });
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

  it('asks the hub for the strip and last night only, not a year', async () => {
    expect((await t.req('GET', '/api/sleep?nights=zero')).status).toBe(400);
    expect((await t.req('GET', '/api/sleep?nights=400')).status).toBe(400);
  });
});

describe('uploads from a Chinese-language iPhone, and what the hub remembers', () => {
  const chinese = [
    '2026年11月22日 上午12:10;2026年11月22日 上午4:10;核心睡眠;我的Apple Watch',
    '2026年11月22日 上午4:10;2026年11月22日 上午5:40;深度睡眠;我的Apple Watch',
  ].join('\n');

  it('stores them', async () => {
    const res = await postSleep(chinese, { headers: { 'content-type': 'text/plain' } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as IngestReply).inserted).toBe(2);
  });

  it('remembers a refused upload and shows it in the read, then the next good one', async () => {
    const bad = await postSleep('2026-11-22T05:40:00-06:00;2026-11-22T07:10:00-06:00;午睡;iPhone', {
      headers: { 'content-type': 'text/plain' },
    });
    expect(bad.status).toBe(400);
    let read = (await (await t.req('GET', '/api/sleep')).json()) as SleepReply & { lastIngest: unknown };
    expect(read.lastIngest).toMatchObject({ ok: false, at: '2026-11-22T18:00:00.000Z' });
    expect((read.lastIngest as { error: string }).error).toMatch(/unknown sleep value "午睡"/);

    t.setNow('2026-11-22T18:05:00.000Z');
    await postSleep(chinese, { headers: { 'content-type': 'text/plain' } });
    read = (await (await t.req('GET', '/api/sleep')).json()) as SleepReply & { lastIngest: unknown };
    expect(read.lastIngest).toEqual({ ok: true, at: '2026-11-22T18:05:00.000Z', inserted: 2, error: null });
  });

  it('starts with no upload remembered', async () => {
    const read = (await (await t.req('GET', '/api/sleep')).json()) as { lastIngest: unknown };
    expect(read.lastIngest).toBeNull();
  });

  it('imports the 导出.xml a Chinese-language iPhone puts in its Health export zip', async () => {
    const fixture = readFileSync(fileURLToPath(new URL('../test/fixtures/export-sample.xml', import.meta.url)));
    const zip = await zipOf({
      'apple_health_export/导出_cda.xml': Buffer.from('<ClinicalDocument/>'),
      'apple_health_export/导出.xml': Buffer.from(fixture),
    });
    const body = new FormData();
    body.append('file', new File([new Uint8Array(zip)], '导出.zip'));
    const res = await t.req('POST', '/api/ingest/health-export', body);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { inserted: number }).inserted).toBe(2);
  });
});

describe('the payload the iPhone Shortcut actually sends', () => {
  // The exact shape the Shortcut writes: a JSON array whose items are joined by "\n\n,", the stage
  // under `value`, ISO dates with an offset, and an empty `source`. Times here are made up.
  const item = (start: string, end: string, value: string) =>
    `{"start":"${start}","end":"${end}","value":"${value}","source":""}`;
  const shortcutBody =
    '[' +
    [
      item('2026-11-20T00:40:00-06:00', '2026-11-20T02:40:00-06:00', 'Core'),
      item('2026-11-20T02:40:00-06:00', '2026-11-20T03:10:00-06:00', 'Deep'),
      item('2026-11-20T03:10:00-06:00', '2026-11-20T03:40:00-06:00', 'REM'),
      item('2026-11-20T03:40:00-06:00', '2026-11-20T03:45:00-06:00', 'Awake'),
      item('2026-11-20T03:45:00-06:00', '2026-11-20T06:45:00-06:00', 'Core'),
    ].join('\n\n,') +
    '\n\n]';

  it('stores it, once, and the night shows in the read', async () => {
    for (const contentType of ['application/json', 'text/plain']) {
      const res = await postSleep(shortcutBody, { headers: { 'content-type': contentType } });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const [night] = (await getSleep()).nights;
    expect(night.night).toBe('2026-11-20');
    expect(night.stages).toMatchObject({ core: 5 * 3600, deep: 30 * 60, rem: 30 * 60, awake: 5 * 60 });
    expect(night.asleepSeconds).toBe(6 * 3600);
    expect(night.source).toBe('Apple Health');
  });
});

it('shows an upload refused for its hub token in the app, since the Shortcut never shows the reply', async () => {
  const remote = { remote: '100.101.102.103', headers: { host: '100.101.102.103:4747' } };
  const res = await t.req('POST', '/api/ingest/sleep', '2026-11-23 23:00;2026-11-24 07:00;Core;Watch', { ...remote, headers: { ...remote.headers, authorization: 'Bearer nope', 'content-type': 'text/plain' } });
  expect(res.status).toBe(401);
  const reply = (await (await t.req('GET', '/api/sleep')).json()) as { lastIngest: { ok: boolean; error: string } | null };
  expect(reply.lastIngest?.ok).toBe(false);
  expect(reply.lastIngest?.error).toContain('hub token is wrong');
});
