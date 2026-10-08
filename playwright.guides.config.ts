import { defineConfig, devices } from "@playwright/test";
import betaConfig from "./playwright.beta.config";

// Isolated synthetic, in-memory fixtures; never record a user's running deployment.
export default defineConfig({
  ...betaConfig,
  testDir: "./tests/demo",
  testMatch: "polling-pops-guides.spec.ts",
  timeout: 900_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "artifacts/polling-pops-guides/playwright",
  projects: [{ name: "guide-chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    ...betaConfig.use,
    actionTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
