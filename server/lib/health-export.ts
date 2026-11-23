// Apple Health's export.xml, streamed: only sleep records become samples, and only the ones the
// hub can use are kept in memory. A record's stage is in `value` or a child <Value>.

import sax from 'sax';
import type { Readable } from 'node:stream';
import type { SleepSample, SleepStage } from '../../shared/types.ts';
import { stageFrom } from './sleep.ts';

const SLEEP_TYPE = 'HKCategoryTypeIdentifierSleepAnalysis';

/** `2026-11-21 23:14:05 -0600` (HealthKit's format; the space before the offset) → ISO-8601 UTC. */
export function healthDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ?([+-]\d{2}:?\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Not a Health date: ${value}`);
  const [, y, mo, d, h, mi, s, offset] = m;
  const zone = offset.includes(':') ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const at = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  if (!Number.isFinite(at)) throw new Error(`Not a Health date: ${value}`);
  return new Date(at).toISOString();
}

/** The stage a sleep record's `value` (or child <Value>) names. A bare Asleep is sleep the Watch didn't split. */
export function stageOfValue(value: string): SleepStage | null {
  const stage = stageFrom(value);
  if (stage) return stage;
  return /^(?:HKCategoryValueSleepAnalysis)?Asleep$/i.test(value.trim()) ? 'asleep' : null;
}

/** One record's sample, or the reason it has none. */
function sampleOf(attrs: Record<string, string>): SleepSample | Error {
  if (!attrs.startDate || !attrs.endDate) {
    return new Error(`A sleep record has no ${attrs.startDate ? 'endDate' : 'startDate'}`);
  }
  const raw = attrs.value ?? '';
  // A record whose type is the bare SleepAnalysis has no value at all, and is plain sleep.
  // One whose value is present names its stage, and must be a stage we can read.
  const stage = raw === '' && attrs.type === SLEEP_TYPE ? 'asleep' : stageOfValue(raw);
  if (!stage) return new Error(`Unknown sleep value: ${raw}`);
  try {
    return { start: healthDate(attrs.startDate), end: healthDate(attrs.endDate), stage, source: attrs.sourceName ?? '' };
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/** A tag as sax holds it. Attributes can be strings or `{ value }` objects, so both are read. */
type Attribute = string | { value?: string };
type Tag = { name: string; attributes: Record<string, Attribute>; isSelfClosing?: boolean };

const attrText = (attribute: Attribute | undefined): string =>
  typeof attribute === 'string' ? attribute : (attribute?.value ?? '');

/**
 * Sleep samples from a Health export, as a stream. Reads with `sax` so a 1 GB export never sits in
 * memory; other record types are skipped unread. Throws on an unknown sleep value, a record
 * without dates, or a file that isn't a well-formed export.
 *
 * sax hands a tag over before it has read its attributes, so a record's tag is kept and read when
 * its content ends. An empty <Record …/> gets only one close event, after its attributes are in;
 * a record with content gets one when the start tag ends (attributes not yet read) and one when
 * it closes.
 */
export async function* parseHealthExport(stream: Readable): AsyncGenerator<SleepSample> {
  const parser = sax.parser(true, { trim: true });
  let record: Tag | null = null;
  let closes = 0;
  let childValue: string | null = null;
  let malformed = false;
  let sawHealthData = false;
  const samples: SleepSample[] = [];
  let problem: Error | null = null;

  parser.onopentag = (tag) => {
    if (tag.name === 'HealthData') sawHealthData = true;
    if (tag.name === 'Record') {
      record = tag as unknown as Tag;
      closes = 0;
      childValue = null;
    } else if (tag.name === 'Value' && record) {
      childValue = attrText(tag.attributes.value);
    }
  };

  parser.onclosetag = (name) => {
    if (name !== 'Record' || !record) return;
    closes += 1;
    const attributes = record.attributes ?? {};
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(attributes)) attrs[k] = attrText(v);
    if (attrs.type !== SLEEP_TYPE) {
      record = null;
      return;
    }
    // The start tag's close comes before its attributes, and an empty element's close after:
    // a sleep record whose attributes are in has its whole story.
    if (Object.keys(attrs).length === 0) {
      record = null;
      return;
    }
    if (childValue !== null) attrs.value = childValue;
    record = null;
    childValue = null;
    const sample = sampleOf(attrs);
    if (sample instanceof Error) problem ??= sample;
    else samples.push(sample);
  };

  // A file that isn't readable as XML isn't a Health export.
  const seen: string[] = [];
  parser.onerror = () => {
    malformed = true;
    seen.push(String(parser.position));
    parser.resume();
  };

  // sax finishes a tag just after handing it over; a tick lets those handlers run before the next
  // write, so a record's close always sees its attributes.
  for await (const chunk of stream) {
    parser.write(chunk.toString());
    await Promise.resolve();
  }
  parser.close();
  await Promise.resolve();
  if (malformed || !sawHealthData) throw new Error(`This file is not a readable Health export (${malformed ? 'malformed' : 'no root'})`);
  if (problem) throw problem;
  yield* samples;
}
