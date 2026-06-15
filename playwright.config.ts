import { defineConfig, devices } from '@playwright/test'

const HOST = '127.0.0.1'
const PORT = 4173
const BASE_URL = `http://${HOST}:${PORT}/`

/** Headless Chromium GPU flags — SwiftShader renders the post stack black without these. */
const CHROMIUM_GPU_ARGS = ['--enable-gpu', '--use-angle=gl-egl']

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    launchOptions: { args: CHROMIUM_GPU_ARGS },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Playwright starts webServer before globalSetup would run; local runs build here, CI builds in workflow.
    command: process.env.CI
      ? `npm run preview -- --host ${HOST} --port ${PORT}`
      : `npm run build && npm run preview -- --host ${HOST} --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 300_000 : 180_000,
  },
})