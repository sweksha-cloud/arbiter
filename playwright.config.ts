import { defineConfig } from '@playwright/test';

import { WEB_URL } from './e2e/api-server';

// End-to-end tests drive real browsers against the built server and web app.
// Run `pnpm build` first (`pnpm test:e2e` does it for you).
export default defineConfig({
  testDir: './e2e',
  // Every test makes its own sessions, so tests can share one server.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    // Phone settings are applied per phone in e2e/helpers.ts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // For machines whose preinstalled Chromium doesn't match this Playwright version.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}
  },
  projects: [
    { name: 'flows', testIgnore: /server-restart/ },
    // Stops and restarts the shared API server, so it runs after everything
    // else, one test at a time.
    { name: 'server-restart', testMatch: /server-restart/, dependencies: ['flows'], workers: 1 }
  ],
  webServer: {
    command: 'pnpm --filter @arbiter/web start --port 3000',
    url: WEB_URL,
    reuseExistingServer: false,
    timeout: 60_000
  }
});
