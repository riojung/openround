import { expect, test } from "@playwright/test";

import { testEmail } from "./test-email";

test("creator can return home, manage checkpoint sets, and sign out on a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const mobileSignInLink = page
    .locator(".site-mobile-actions")
    .getByRole("link", { name: "Sign in", exact: true });
  await mobileSignInLink.click();

  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(testEmail("navigation", testInfo));
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();

  await page.getByLabel("Checkpoint set title").fill("Navigation quiz");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(page).toHaveURL(/\/quiz\//);
  await page.getByRole("link", { name: "OpenRound" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Manage Rounds" })).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "My Rounds", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Navigation quiz", exact: true }) }),
  ).toHaveCount(1);

  await page.getByRole("link", { name: "OpenRound" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(mobileSignInLink).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin/);
});

test("creator can archive, restore, export, and delete their account", async ({
  page,
}, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(testEmail("lifecycle", testInfo));
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();

  await page.getByLabel("Checkpoint set title").fill("Lifecycle quiz");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(page).toHaveURL(/\/quiz\//);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const quizCard = page.getByRole("article").filter({ hasText: "Lifecycle quiz" });
  await quizCard.getByRole("button", { name: "Archive" }).click();
  await expect(quizCard).toHaveCount(0);

  await page.getByLabel("Include archived sets").check();
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

test("workspace owner invites a viewer with read-only access", async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto("/signin");
  await owner.getByRole("button", { name: "Workplace" }).click();
  await owner.getByLabel("Email address").fill(testEmail("workspace-owner", testInfo));
  await owner.getByLabel(/I accept the Terms/).check();
  await owner.getByRole("button", { name: "Send sign-in link" }).click();
  await owner.getByRole("link", { name: "Continue to dashboard" }).click();

  await owner.getByLabel("Checkpoint set title").fill("Shared safety check");
  await owner.getByRole("button", { name: "Create checkpoint set" }).click();
  await owner.getByRole("link", { name: "Dashboard" }).click();
  await owner.getByRole("link", { name: "Account", exact: true }).click();

  const viewerEmail = testEmail("workspace-viewer", testInfo);
  await owner.getByLabel("Email address").fill(viewerEmail);
  await owner.getByLabel("Role").selectOption("viewer");
  await owner.getByRole("button", { name: "Invite member" }).click();
  await expect(owner.getByRole("status")).toContainText(`Invitation sent to ${viewerEmail}`);
  const invitationUrl = await owner
    .getByRole("link", { name: "open invitation" })
    .getAttribute("href");
  expect(invitationUrl).toBeTruthy();

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await viewer.goto(invitationUrl!);
  await viewer.getByLabel(/I accept the Terms/).check();
  await viewer.getByRole("button", { name: "Accept invitation" }).click();
  await expect(viewer).toHaveURL(/\/dashboard\?invitation=accepted/);
  await expect(viewer.getByText("Viewer access is read-only")).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Create checkpoint set" })).toHaveCount(0);
  const sharedSet = viewer.getByRole("article").filter({ hasText: "Shared safety check" });
  await expect(sharedSet.getByRole("link", { name: "View" })).toBeVisible();
  await expect(sharedSet.getByRole("button", { name: "Host" })).toHaveCount(0);

  await viewerContext.close();
  await ownerContext.close();
});
