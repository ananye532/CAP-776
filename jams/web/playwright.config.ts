import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    // Use a preinstalled Chromium when PLAYWRIGHT_CHROMIUM_PATH is set.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
  ],
  webServer: [
    {
      command: 'node --import tsx test/e2e-server.ts',
      cwd: '../server',
      port: API_PORT,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://jams:jams@localhost:5432/jams_test',
        STORAGE_DIR: './.e2e-storage',
        ANTHROPIC_API_KEY: '',
      },
    },
    {
      command: `../node_modules/.bin/vite --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
