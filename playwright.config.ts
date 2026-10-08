import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://localhost:3000', viewport: { width: 393, height: 852 }, headless: true },
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
