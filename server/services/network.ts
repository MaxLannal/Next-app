import { networkInterfaces } from 'node:os';
import type { Run } from './mac.ts';

/** `tailscale ip -4` when there is one, else null: the Mac's tailnet address. */
export async function tailscaleIp(run: Run): Promise<string | null> {
  const out = await run('tailscale', ['ip', '-4'], { timeoutMs: 5_000 });
  const first = out.stdout.trim().split('\n')[0]?.trim() ?? '';
  return out.code === 0 && isIPv4(first) ? first : null;
}

const isIPv4 = (value: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);

/**
 * The address the iPhone should reach the hub at: the Mac's Tailscale IPv4 when
 * the Tailscale app is up (it answers `tailscale ip -4`), else the first
 * non-internal IPv4. Null when the Mac is on no network.
 */
export async function ingestHost(run: Run): Promise<string | null> {
  const tail = await tailscaleIp(run);
  if (tail !== null) return tail;

  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal && isIPv4(net.address)) return net.address;
    }
  }
  return null;
}
