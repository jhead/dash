import { defineConfig } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isCI = Boolean((globalThis as any).process?.env?.CI);

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:1420',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !isCI,
  },
});
