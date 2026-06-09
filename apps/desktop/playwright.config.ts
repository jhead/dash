import { defineConfig, devices } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isCI = Boolean((globalThis as any).process?.env?.CI);

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:1420',
    // Disable background throttling so requestAnimationFrame fires at full rate
    // even when the test tab is not in the foreground. Ruffle uses rAF for its
    // playback loop — without this, animation-based tests flake in headless mode.
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !isCI,
  },
});
