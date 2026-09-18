import { expect, test } from "@playwright/test";

import { testEmail } from "./test-email";

test("feature-off creator remains on the legacy dashboard", async ({ page }, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(testEmail("ux-beta-off", testInfo));
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Your checkpoint sets" })).toBeVisible();
  await expect(page.getByLabel("Checkpoint set title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create checkpoint set" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create Round" })).toHaveCount(0);

  await page.getByLabel("Checkpoint set title").fill("Legacy rollback check");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(page).toHaveURL(/\/quiz\//);
  await page.goto("/dashboard");
  const legacyCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Legacy rollback check" }) });
  await expect(legacyCard.getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(legacyCard.getByRole("button", { name: "Duplicate" })).toBeVisible();
  await expect(legacyCard.getByRole("button", { name: "Organize" })).toBeVisible();
  await expect(legacyCard.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(legacyCard.getByText("More", { exact: true })).toHaveCount(0);
  await expect(legacyCard.getByRole("link", { name: "Rehearse" })).toHaveCount(0);

  await page.goto("/create");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByLabel("Checkpoint set title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toHaveCount(0);
});
