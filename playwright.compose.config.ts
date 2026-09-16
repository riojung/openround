import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/compose-e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.COMPOSE_WEB_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "compose-chromium", use: { ...devices["Desktop Chrome"] } }],
});
