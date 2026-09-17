import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { testEmail } from "./test-email";

test("creator and participant complete a live round", async ({ browser }, testInfo) => {
  const creatorContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  await creator.goto("/signin");
  await creator.getByRole("button", { name: "Education" }).click();
  await creator.getByLabel("Email address").fill(testEmail("live-round", testInfo));
  await creator.getByLabel(/I accept the Terms/).check();
  await creator.getByRole("button", { name: "Send sign-in link" }).click();
  await creator.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(creator).toHaveURL(/\/dashboard/);

  await creator.getByLabel("Quiz title").fill("A one-question check");
  await creator.getByRole("button", { name: "Create quiz" }).click();
  await expect(creator).toHaveURL(/\/quiz\//);
  await creator.getByRole("button", { name: "Add true or false" }).click();
  await creator
    .getByRole("textbox", { name: "Question", exact: true })
    .fill("Edmonton is the capital of Alberta.");
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await creator.getByRole("button", { name: "Preview" }).click();
  await expect(creator).toHaveURL(/\/quiz\/[^/]+\/preview/);
  await expect(creator.getByText("Edmonton is the capital of Alberta.")).toBeVisible();
  await creator.getByRole("button", { name: "Reveal answer" }).click();
  await expect(creator.locator('.answer-button[data-correct="true"]')).toContainText("True");
  await creator.getByRole("link", { name: "Back to editor" }).click();
  await expect(creator).toHaveURL(/\/quiz\/[^/]+$/);
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  const publishResponsePromise = creator.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/publish"),
  );
  await creator.getByRole("button", { name: "Publish" }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.status()).toBe(200);
  await expect(creator.getByText("published", { exact: true })).toBeVisible();
  await creator.getByRole("link", { name: "Dashboard" }).click();
  await expect(creator.getByText(/1 of 5 published quiz slots used/)).toBeVisible({
    timeout: 10_000,
  });
  await creator.getByRole("button", { name: "Host" }).click();
  await expect(creator).toHaveURL(/\/host\/setup\//);
  await expect(creator.getByLabel("Maximum participants")).toHaveValue("20");
  await expect(creator.getByLabel(/Allow participants to join/)).toBeChecked();
  await expect(creator.getByLabel("Scoring mode")).toHaveValue("accuracy");
  await expect(creator.getByLabel("Results during the round")).toHaveValue("private");
  await expect(creator.getByLabel("Participant names")).toHaveValue("friendly_only");
  await creator.getByRole("button", { name: "Create live session" }).click();
  await expect(creator).toHaveURL(/\/host\/(?!setup\/)[^/]+$/);
  expect((await new AxeBuilder({ page: creator }).analyze()).violations).toEqual([]);
  const code = (await creator.locator(".session-code").textContent())!.trim();
  const expectedJoinUrl = `${new URL(creator.url()).origin}/join?code=${code}`;
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", expectedJoinUrl);
  await expect(
    creator.getByLabel(new RegExp(`QR code for round ${code.split("").join(" ")}`)),
  ).toBeVisible();

  const lanJoinUrl = `http://192.168.1.20:8080/join?code=${code}`;
  await creator.getByLabel("Network or public product address").fill("http://192.168.1.20:8080");
  await creator.getByRole("button", { name: "Update QR" }).click();
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", lanJoinUrl);

  await creator.getByRole("button", { name: "Presenter view" }).click();
  await expect(creator).toHaveURL(/\/present\//);
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", lanJoinUrl);
  await creator.getByRole("button", { name: "Host controls" }).click();
  await creator.getByText("Change join address").click();
  await creator.getByRole("button", { name: "Reset address" }).click();
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", expectedJoinUrl);

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/join?code=${code}`);
  await participant.getByLabel("Nickname").fill("Learner");
  await participant.getByRole("button", { name: "Join round" }).click();
  await expect(participant).toHaveURL(/\/play\//);
  await expect(creator.getByText(/Bright|Calm|Curious|Kind|Quick|Sunny/)).toBeVisible();

  await creator.getByRole("button", { name: "Start round" }).click();
  await expect(participant.getByText("Edmonton is the capital of Alberta.")).toBeVisible();
  expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
  await participant.getByRole("button", { name: "True", exact: true }).click();
  await expect(participant.getByText("Answer received and saved.")).toBeVisible();
  await creator.getByRole("button", { name: "Lock answers" }).click();
  await creator.getByRole("button", { name: "Reveal answer" }).click();
  await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
  await creator.getByRole("button", { name: "Finish round" }).click();
  await creator.getByRole("link", { name: "Open report" }).click();
  await expect(
    creator.locator(".metric").filter({ hasText: "accuracy" }).getByText("100%", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(creator.getByRole("link", { name: "CSV export requires Pro" })).toBeVisible();
  await expect(creator.getByText(/current free plan defaults to 30 days/)).toBeVisible();
  expect((await new AxeBuilder({ page: creator }).analyze()).violations).toEqual([]);

  await participantContext.close();
  await creatorContext.close();
});

test("quiz autosave serializes overlapping edits", async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const creator = await context.newPage();
  await creator.goto("/signin");
  await creator.getByRole("button", { name: "Workplace" }).click();
  await creator.getByLabel("Email address").fill(testEmail("autosave", testInfo));
  await creator.getByLabel(/I accept the Terms/).check();
  await creator.getByRole("button", { name: "Send sign-in link" }).click();
  await creator.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(creator).toHaveURL(/\/dashboard/);
  await creator.getByLabel("Quiz title").fill("Autosave ordering");
  await creator.getByRole("button", { name: "Create quiz" }).click();
  await expect(creator).toHaveURL(/\/quiz\//);
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });

  let patchCount = 0;
  let markFirstStarted!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await creator.route("**/v1/quizzes/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    patchCount += 1;
    if (patchCount === 1) {
      markFirstStarted();
      await firstCanFinish;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await creator.getByRole("button", { name: "Add true or false" }).click();
  const question = creator.getByRole("textbox", { name: "Question", exact: true });
  await question.fill("First edit");
  await firstStarted;
  await question.fill("Latest edit");
  await creator.waitForTimeout(900);
  expect(patchCount).toBe(1);

  releaseFirst();
  await expect.poll(() => patchCount).toBe(2);
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await creator.reload();
  await expect(question).toHaveValue("Latest edit");
  await context.close();
});

test("incomplete questions autosave with actionable guidance", async ({ page }, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(testEmail("guidance", testInfo));
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();

  await page.getByLabel("Quiz title").fill("Validation guidance");
  await page.getByRole("button", { name: "Create quiz" }).click();
  await page.getByRole("button", { name: "Add multiple choice" }).click();
  await expect(page.getByRole("status")).toContainText("Saving");
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });

  const guidance = page.locator(".validation-guidance");
  await expect(guidance).toContainText("Source: Question 1");
  await expect(guidance).toContainText(
    "Enter the question text; fill answer choices 1, 2, 3, and 4 before previewing or publishing.",
  );
  await expect(guidance).toContainText("in-progress draft is still saved automatically");

  await page.reload();
  await expect(page.getByRole("button", { name: /1\. Untitled question/ })).toBeVisible();
  await page.goto(`${page.url()}/preview`);
  await expect(page.locator(".live-card .error[role='alert']")).toContainText(
    "Preview unavailable. Question 1: Enter the question text.",
  );
  await page.getByRole("link", { name: "Return to editor" }).click();
  await expect(page).toHaveURL(/\/quiz\/[^/]+$/);
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  const publishButton = page.getByRole("button", { name: "Publish" });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(guidance).toHaveAttribute("role", "alert");
  await expect(guidance).toContainText("Cannot publish this quiz yet");
  await expect(guidance).toContainText("Source: Question 1");

  await page
    .getByRole("textbox", { name: "Question", exact: true })
    .fill("Which number comes after 41?");
  for (const [index, answer] of ["40", "41", "42", "43"].entries()) {
    await page.getByRole("textbox", { name: `Choice ${index + 1}`, exact: true }).fill(answer);
  }
  await expect(guidance).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await publishButton.click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
});
