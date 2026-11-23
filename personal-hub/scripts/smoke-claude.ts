// Manual smoke test for the gateway: `node scripts/smoke-claude.ts path/to/handwriting.jpg`.
// Reads ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN and (optional) ANTHROPIC_MODEL from the
// environment, exactly as the hub's caller would, and prints the reading. Never prints tokens.
import { readFileSync } from 'node:fs';
import { createClaudeClient } from '../server/services/claude.ts';

const file = process.argv[2];
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
