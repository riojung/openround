import { expect, test } from "@playwright/test";

test("creator can return home, manage quizzes, and sign out on a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();

  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(`navigation-${testInfo.project.name}@example.com`);
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();

  await page.getByLabel("Quiz title").fill("Navigation quiz");
  await page.getByRole("button", { name: "Create quiz" }).click();
  await page.getByRole("link", { name: "OpenRound" }).click();
  await expect(page.getByRole("link", { name: "Manage my quizzes" })).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "My quizzes", exact: true })
    .click();
  await expect(page.getByRole("article").filter({ hasText: "Navigation quiz" })).toBeVisible();

  await page.getByRole("link", { name: "OpenRound" }).click();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin/);
});

test("creator can archive, restore, export, and delete their account", async ({
  page,
}, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(`lifecycle-${testInfo.project.name}@example.com`);
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();

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
