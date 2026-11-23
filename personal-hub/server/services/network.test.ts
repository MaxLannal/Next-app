import { expect, it } from 'vitest';
import { ingestHost } from './network.ts';

const runAnswer = (code: number, stdout: string) => async () => ({ code, stdout, stderr: '' });

it('prefers the Tailscale IPv4 when the app answers', async () => {
  const host = await ingestHost(runAnswer(0, '100.101.102.103\n'));
  expect(host).toBe('100.101.102.103');
});

it('falls back to a local IPv4 without Tailscale', async () => {
  const host = await ingestHost(runAnswer(127, ''));
  // Whatever this Mac is on, the answer is one address or none — never the tailscale output.
  expect(host === null || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)).toBe(true);
  expect(host).not.toBe('100.101.102.103');
});

it('ignores a broken tailscale reply', async () => {
  const host = await ingestHost(runAnswer(0, 'not an address\n'));
  expect(host).not.toBe('not an address');
});
