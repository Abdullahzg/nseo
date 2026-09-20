import { defineConfig } from "@playwright/test";

// Runs against the DEPLOYED demo by default (E2E_BASE_URL), or a local dev server.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL || "http://localhost:3000", headless: true, screenshot: "only-on-failure", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
