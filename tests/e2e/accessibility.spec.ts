import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { testEmail } from "./test-email";

for (const path of ["/", "/join", "/signin", "/pricing"]) {
  test(`${path} has no automatically detectable accessibility violations`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.headers()["content-security-policy"]).toMatch(
      /script-src[^;]*'nonce-[^']+'[^;]*'strict-dynamic'/,
    );
    await expect(page.locator("body")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("authenticated creator surfaces have no automatically detectable accessibility violations", async ({
  page,
}, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(testEmail("accessibility", testInfo));
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await page.waitForURL(/\/dashboard/, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Your quizzes", level: 1 })).toBeVisible();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByLabel("Quiz title").fill("Accessible authoring check");
  await page.getByRole("button", { name: "Create quiz" }).click();
  await page.waitForURL(/\/quiz\//, { waitUntil: "load" });
  await expect(
    page.getByRole("heading", { name: "Accessible authoring check", level: 1 }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
