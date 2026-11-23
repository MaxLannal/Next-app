import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ImageReading } from '../../shared/types.ts';
import type { HubConfig } from '../config.ts';
import type { ClaudeClient } from '../context.ts';
import { UnavailableError } from '../context.ts';

type AnthropicConfig = HubConfig['anthropic'];

const READ_SYSTEM = "You read photos of someone's finished work. If the photo shows handwritten or printed mathematics or technical writing, transcribe it faithfully into LaTeX body content (no preamble), preserving line structure with align* where natural; set kind to latex and caption to a one-line description. Otherwise set kind to caption, write a one-line description, and leave latex empty. Never invent content that is not visible.";
const JSON_SUFFIX = 'Reply with only a JSON object with keys kind, latex, caption';

const Reading = z.object({
  kind: z.enum(['latex', 'caption']),
  latex: z.string(),
  caption: z.string(),
});

const MODEL_MISSING = 'Model not found on the gateway';

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
    const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.data.toString('base64') } };
    try {
      const message = await client.messages.parse({
        model,
        max_tokens: 16000,
        system: READ_SYSTEM,
        messages: [{ role: 'user', content: [image, { type: 'text', text: 'Read this photo.' }] }],
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
          messages: [{ role: 'user', content: [image, { type: 'text', text: 'Read this photo.' }] }],
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
