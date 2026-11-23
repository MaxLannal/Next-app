// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from './vite.config.ts';

describe('dev proxy', () => {
  it('forwards /api to the hub and keeps the Host header', () => {
    // Vite's string shorthand turns changeOrigin on, which rewrites Host to
    // localhost:4747; the hub then sees Origin ≠ Host and refuses every write.
    const proxy = config.server?.proxy?.['/api'];
    expect(proxy).toMatchObject({ target: 'http://localhost:4747' });
    expect(typeof proxy === 'object' ? proxy.changeOrigin : true).toBeFalsy();
  });
});