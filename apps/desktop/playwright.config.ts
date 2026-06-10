import { defineConfig, devices } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isCI = Boolean((globalThis as any).process?.env?.CI);

export default defineConfig({
  testDir: './e2e',
  // The /__agent WebSocket bridge is a singleton: only one browser page can
  // hold the bridge at a time.  Running multiple workers in parallel causes
  // each worker's page.goto('/') to disconnect the previous worker's bridge,
  // producing "Editor page disconnected before responding" errors.  Serialise
  // the full suite so each test gets an uncontested bridge connection.
  workers: 1,
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
