import { defineConfig } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Reuse the existing runner. These tests request no browser/page fixtures.
export default defineConfig({
  testDir: "./tests/unit", workers: 1, reporter: "list",
  outputDir: join(tmpdir(), `foodorder-cart-unit-${process.pid}`),
})
