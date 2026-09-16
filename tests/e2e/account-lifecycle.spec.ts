import { expect, test } from "@playwright/test";

test("creator can archive, restore, export, and delete their account", async ({
  page,
}, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(`lifecycle-${testInfo.project.name}@example.com`);
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "open sign-in link" }).click();

  await page.getByLabel("Quiz title").fill("Lifecycle quiz");
  await page.getByRole("button", { name: "Create quiz" }).click();
  await expect(page).toHaveURL(/\/quiz\//);
  await page.getByRole("link", { name: "Dashboard" }).click();

  const quizCard = page.getByRole("article").filter({ hasText: "Lifecycle quiz" });
  await quizCard.getByRole("button", { name: "Archive" }).click();
  await expect(quizCard).toHaveCount(0);

  await page.getByLabel("Include archived quizzes").check();
  const archivedCard = page.getByRole("article").filter({ hasText: "Lifecycle quiz" });
  await expect(archivedCard.getByText("archived", { exact: true })).toBeVisible();
  await archivedCard.getByRole("button", { name: "Restore" }).click();
  await expect(archivedCard.getByText("draft", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Account", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download account export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("openround-account-export.json");
  await expect(page.getByRole("status")).toContainText("account export was downloaded");

  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin/);
});
