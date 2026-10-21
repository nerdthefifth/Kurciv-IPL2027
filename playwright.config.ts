import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the production build in the locally installed Microsoft Edge
 * (no browser download needed). Override with E2E_CHANNEL=chrome if preferred.
 */
const PORT = 4317;
const channel = process.env.E2E_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Edge'], channel, viewport: { width: 1440, height: 960 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { channel, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    cwd: 'apps/web',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
