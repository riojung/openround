import { defineConfig, devices } from "@playwright/test";

const betaE2eWebPort = Number(process.env.BETA_E2E_WEB_PORT ?? 3200);
const betaE2eApiPort = Number(process.env.BETA_E2E_API_PORT ?? 4200);
const betaWorkspaceId = "00000000-0000-4000-8000-00000000b001";

export default defineConfig({
  testDir: "./tests/beta-e2e",
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 10_000 },
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results-beta",
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-beta" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${betaE2eWebPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-beta",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-beta",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "chromium-beta-mobile",
      grep: /@mobile/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "webkit-beta-mobile",
      grep: /@mobile/,
      use: {
        ...devices["iPhone 15"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      command: `NODE_ENV=test PORT=${betaE2eApiPort} ALLOW_IN_MEMORY=true COMMUNITY_MODE=false WEB_ORIGIN=http://127.0.0.1:${betaE2eWebPort} PUBLIC_API_URL=http://127.0.0.1:${betaE2eApiPort} FEATURE_UX_BETA=true FEATURE_RECOVERY_REHEARSAL=true FEATURE_PRACTICE_ASSIGNMENTS=true FEATURE_WORKSPACE_SHELL=true FEATURE_BUILDER_V2=true FEATURE_PRESENTATIONS=true FEATURE_GROUPS=true FEATURE_DISCOVER=true UX_BETA_WORKSPACE_ALLOWLIST=${betaWorkspaceId} TEST_INITIAL_WORKSPACE_ID=${betaWorkspaceId} TEST_INITIAL_PLAN=pro LOG_LEVEL=silent pnpm --filter @openround/server dev`,
      port: betaE2eApiPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `node scripts/prepare-playwright-next.mjs && NEXT_PUBLIC_API_URL=http://127.0.0.1:${betaE2eApiPort} pnpm --filter @openround/web exec next dev -p ${betaE2eWebPort}`,
      port: betaE2eWebPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
