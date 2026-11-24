import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ImageReading } from '../../shared/types.ts';
import type { HubConfig } from '../config.ts';
import type { ClaudeClient } from '../context.ts';
import { UnavailableError } from '../context.ts';

type AnthropicConfig = HubConfig['anthropic'];

const READ_SYSTEM = [
  "You read photos and scans of someone's finished work: homework, proofs, notes.",
  'If the page shows handwritten or printed mathematics or technical writing, transcribe all of it faithfully as LaTeX body content: no preamble, no \\documentclass, no \\begin{document}.',
  'Write words as plain text and every piece of math in math mode: inline math in $...$, displayed equations in \\[...\\], and multi-line working in \\begin{align*}...\\end{align*}.',
  'Keep the order and structure of the page: put each problem number or part in bold on its own line (\\textbf{7.1}, \\textbf{(a)}), and give each step its own paragraph, separated by a blank line.',
  'It is shown with KaTeX, so use only standard amsmath and amssymb commands: no other packages, no TikZ, no \\label. Describe a drawing in one short line, like [Figure: graph of f with zeros at a, b, c].',
  'Leave out crossed-out writing. If a symbol is unclear, choose the reading that makes the mathematics consistent.',
  'Set kind to latex and caption to a one-line description.',
  'If the page holds no mathematics or technical writing, set kind to caption, write a one-line description, and leave latex empty.',
  'Never invent content that is not on the page.',
].join(' ');
const JSON_SUFFIX = 'Reply with only a JSON object with keys kind, latex, caption';

const Reading = z.object({
  kind: z.enum(['latex', 'caption']),
  latex: z.string(),
  caption: z.string(),
});

export const MODEL_MISSING = 'Model not found on the gateway';

function onGatewayMissingModel(err: unknown): never {
  if (err instanceof Anthropic.NotFoundError) throw new UnavailableError(MODEL_MISSING);
  throw err;
}

/** Only the part the hub uses; a latex reading carries no caption (see `ImageReading`). */
const toReading = (r: z.infer<typeof Reading>): ImageReading =>
  r.kind === 'latex' ? { kind: 'latex', latex: r.latex } : { kind: 'caption', caption: r.caption };

/** The JSON object in a text reply, alone or inside a code fence. */
function parseReading(text: string): z.infer<typeof Reading> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('The gateway replied without a JSON object');
  return Reading.parse(JSON.parse(text.slice(start, end + 1)));
}

/**
 * Claude through the configured gateway: bearer token, no API key. The model defaults to
 * an Opus-tier id; a gateway that doesn't have it answers 404, which setup reads
 * as "try ANTHROPIC_MODEL".
 */
export function createClaudeClient(cfg: AnthropicConfig): ClaudeClient {
  const client = new Anthropic({ baseURL: cfg.baseURL ?? undefined, authToken: cfg.authToken, apiKey: null });
  const model = cfg.model;

  async function readImage(img: Parameters<ClaudeClient['readImage']>[0]) {
    const data = img.data.toString('base64');
    // A photo goes as an image; a scanned PDF as a document, which Claude reads page by page.
    const image =
      img.mediaType === 'application/pdf'
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } };
    try {
      const message = await client.messages.parse({
        model,
        max_tokens: 16000,
        system: READ_SYSTEM,
        messages: [{ role: 'user', content: [image, { type: 'text', text: 'Read this page.' }] }],
        output_config: { format: zodOutputFormat(Reading) },
      });
      const reading = message.parsed_output;
      if (!reading) {
        const blocks = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
        throw new Error(`The gateway answered without a parsed reading: ${blocks.slice(0, 300)}`);
      }
      return toReading(reading);
    } catch (err) {
      // A 404 is the model, not structured outputs: don't spend a second call on it.
      if (!(err instanceof Anthropic.BadRequestError)) return onGatewayMissingModel(err);
      // The gateway may not support structured outputs: ask for the same shape as plain JSON.
      try {
        const message = await client.messages.create({
          model,
          max_tokens: 16000,
          system: `${READ_SYSTEM} ${JSON_SUFFIX}`,
          messages: [{ role: 'user', content: [image, { type: 'text', text: 'Read this page.' }] }],
        });
        const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
        return toReading(parseReading(text));
      } catch (retryErr) {
        return onGatewayMissingModel(retryErr);
      }
    }
  }

  async function streamTurn(
    p: Parameters<ClaudeClient['streamTurn']>[0],
    onText: (delta: string) => void,
  ): ReturnType<ClaudeClient['streamTurn']> {
    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 64000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          system: p.system,
          messages: p.messages,
          tools: p.tools,
        },
        { signal: p.signal },
      );
      stream.on('text', onText);
      try {
        return await stream.finalMessage();
      } finally {
        stream.off('text', onText); // the stream is done either way; the caller's closure can go
      }
    } catch (err) {
      return onGatewayMissingModel(err);
    }
  }

  return { readImage, streamTurn };
}
