import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseHealthExport } from './health-export.ts';

const FIXTURE = fileURLToPath(new URL('../test/fixtures/export-sample.xml', import.meta.url));

async function collect(stream: Readable) {
  const out = [];
  for await (const sample of parseHealthExport(stream)) out.push(sample);
  return out;
}

/** The fixture, split into small chunks so the parser meets tags and text across chunk edges. */
function chunked(text: string, size: number): Readable {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return Readable.from(chunks);
}

describe('parseHealthExport', () => {
  it('health export', async () => {
    const samples = await collect(Readable.from([readFileSync(FIXTURE)]));
    expect(samples).toEqual([
      {
        start: '2026-11-22T05:14:05.000Z',
        end: '2026-11-22T06:40:00.000Z',
        stage: 'in_bed',
        source: 'My Apple Watch',
      },
      {
        start: '2026-11-22T05:14:05.000Z',
        end: '2026-11-22T06:40:00.000Z',
        stage: 'core',
        source: 'My Apple Watch',
      },
    ]);
  });

  it('reads the same samples when the XML arrives in small chunks', async () => {
    const samples = await collect(chunked(readFileSync(FIXTURE, 'utf8'), 17));
    expect(samples.map((s) => s.stage)).toEqual(['in_bed', 'core']);
  });

  it('maps every stage value and skips other record types', async () => {
    const record = (value: string, type = 'HKCategoryTypeIdentifierSleepAnalysis') =>
      `<Record type="${type}" sourceName="iPhone" startDate="2026-11-21 22:00:00 -0600" endDate="2026-11-21 23:00:00 -0600">` +
      `<Value value="HKCategoryValueSleepAnalysis${value}"/></Record>`;
    const xml =
      '<HealthData>' +
      ['InBed', 'AsleepUnspecified', 'Asleep', 'Awake', 'AsleepCore', 'AsleepDeep', 'AsleepREM'].map((v) => record(v)).join('') +
      record('InBed', 'HKCategoryTypeIdentifierMindfulSession') +
      '<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone"><Value value="9"/></Record>' +
      '</HealthData>';
    const samples = await collect(Readable.from([xml]));
    expect(samples).toHaveLength(7);
    expect(samples.map((s) => s.stage)).toEqual(['in_bed', 'asleep', 'asleep', 'awake', 'core', 'deep', 'rem']);
  });

  it('rejects an unknown sleep value and a record without dates', async () => {
    const unknown =
      '<HealthData><Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" startDate="2026-11-21 22:00:00 -0600" endDate="2026-11-21 23:00:00 -0600"><Value value="HKCategoryValueSleepAnalysisNap"/></Record></HealthData>';
    await expect(collect(Readable.from([unknown]))).rejects.toThrow(/HKCategoryValueSleepAnalysisNap/);
    const undated =
      '<HealthData><Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone"><Value value="HKCategoryValueSleepAnalysisInBed"/></Record></HealthData>';
    await expect(collect(Readable.from([undated]))).rejects.toThrow(/startDate/);
  });

  it('reads the DOCTYPE and a record with nothing in it', async () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData [<!ENTITY foo "bar">]>\n' +
      '<HealthData><Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-11-21 22:00:00 -0600" endDate="2026-11-21 23:00:00 -0600"/></HealthData>';
    // No value at all: plain sleep, as iOS 17 writes a night it didn't stage.
    const [sample] = await collect(Readable.from([xml]));
    expect(sample.stage).toBe('asleep');
    expect(sample.source).toBe('Watch');
  });
});
