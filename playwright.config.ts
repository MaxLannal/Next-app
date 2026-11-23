import { defineConfig } from '@playwright/test';

// Two hubs, one per viewport, each on a fresh empty data folder (e2e/serve.sh): the phone run
// never sees what the desktop run made. Uses the Chrome already on the Mac; never port 4747.
const DESKTOP_PORT = 4831;
const PHONE_PORT = 4832;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: 'test-results/e2e',
  reporter: [['list']],
  use: { channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${DESKTOP_PORT}` } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, baseURL: `http://localhost:${PHONE_PORT}` } },
  ],
  webServer: [DESKTOP_PORT, PHONE_PORT].map((port) => ({
    command: `bash e2e/serve.sh ${port}`,
    url: `http://localhost:${port}/api/ping`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore' as const,
  })),
});
