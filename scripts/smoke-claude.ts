// Manual smoke test for the gateway: `node scripts/smoke-claude.ts path/to/handwriting.jpg`.
// Reads ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN and (optional) ANTHROPIC_MODEL from the
// environment, exactly as the hub's caller would, and prints the reading. Never prints tokens.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createClaudeClient } from '../server/services/claude.ts';

let file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/smoke-claude.ts <image>');
  process.exit(2);
}

const baseURL = process.env.ANTHROPIC_BASE_URL ?? null;
const authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? null;
if (!baseURL || !authToken) {
  console.error('Set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN first (they are shell variables, not files).');
  process.exit(2);
}
const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';

// The client takes JPEG; convert anything else the way the hub does, through sips.
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' };
const ext = extname(file).slice(1).toLowerCase();
const mime = MIME[ext];
if (!mime) {
  console.error(`Unknown file type ".${ext}" — pass a jpg, png, heic, heif or pdf.`);
  process.exit(2);
}
if (mime !== 'image/jpeg') {
  const jpeg = join(tmpdir(), `smoke-claude-${process.pid}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', file, '--out', jpeg]);
  file = jpeg;
  console.error(`Converted to JPEG for the reading: ${jpeg}`);
}

const client = createClaudeClient({ baseURL, authToken, model });
const started = Date.now();
try {
  const reading = await client.readImage({ data: readFileSync(file), mediaType: 'image/jpeg' });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Model ${model} answered in ${seconds} s from ${baseURL}`);
  if (reading.kind === 'latex') {
    console.log('kind: latex');
    console.log(reading.latex);
  } else {
    console.log('kind: caption');
    console.log(reading.caption);
  }
} catch (err) {
  console.error(`Couldn't read the photo: ${(err as Error).message}`);
  process.exitCode = 1;
}
