import { defineConfig } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: join(tmpdir(), `foodorder-auth-results-${process.pid}`),
  use: {
    browserName: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    // Auth traffic contains credentials. Do not record traces, videos or screenshots.
    trace: "off", video: "off", screenshot: "off",
  },
})
