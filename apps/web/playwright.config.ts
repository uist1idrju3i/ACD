import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: [
    {
      command:
        "pnpm --filter @acd/worker start -- --root=../../fixtures/phase4/wp6-browser-run --graph=../../fixtures/phase4/wp6-browser-run/graph.json --port=4174",
      port: 4174,
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @acd/web dev -- --host 127.0.0.1",
      port: 4173,
      reuseExistingServer: false,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["list"], ["json", { outputFile: "../../artifacts/phase4/wp6-browser-run.json" }]],
});
