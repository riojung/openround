import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Education" }).click();
  await page.getByLabel("Email address").fill("ux-beta-e2e@example.com");
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Rounds", level: 1 })).toBeVisible();
}

async function expectNoAxeViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function createPublishedPracticeSource(page: Page) {
  const starter = await page.request.post(`${apiUrl}/v1/starters/misconception-check/use`, {
    data: {},
  });
  expect(starter.status()).toBe(201);
  const quizId = (await starter.json()).quiz.id as string;
  const published = await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(published.ok()).toBeTruthy();
  return quizId;
}

async function createPracticeAssignment(page: Page, quizId: string) {
  const creationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/quizzes/${quizId}/practice-assignments`,
  );
  const create = page.getByRole("button", { name: "Create assignment" });
  await create.scrollIntoViewIfNeeded();
  await create.click();
  const creationResponse = await creationResponsePromise;
  expect(creationResponse.status()).toBe(201);
  const creation = (await creationResponse.json()) as {
    followup: { id: string };
    genericUrl: string;
  };
  return { followupId: creation.followup.id, genericUrl: creation.genericUrl };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test("beta workspace and creation surfaces pass automated accessibility checks", async ({
  page,
}) => {
  await signIn(page);
  await expectNoAxeViolations(page);

  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("practice assignment and management surfaces pass automated accessibility checks", async ({
  page,
}) => {
  await signIn(page);
  const quizId = await createPublishedPracticeSource(page);

  await page.goto(`/quiz/${quizId}/assign`);
  await expect(page.getByRole("heading", { name: "Practice settings", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);

  const { followupId } = await createPracticeAssignment(page, quizId);
  await expect(page.getByRole("heading", { name: "Save and share these links now" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto(`/practice/${followupId}`);
  await expect(page.getByRole("heading", { name: "Misconception check", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private access", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("mobile practice assignment and management surfaces remain accessible @mobile", async ({
  page,
}) => {
  await signIn(page);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const quizId = await createPublishedPracticeSource(page);

  await page.goto(`/quiz/${quizId}/assign`);
  await expect(page.getByRole("heading", { name: "Practice settings", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  const create = page.getByRole("button", { name: "Create assignment" });
  await create.scrollIntoViewIfNeeded();
  const createTarget = await create.boundingBox();
  expect(createTarget?.height).toBeGreaterThanOrEqual(44);

  const { followupId, genericUrl } = await createPracticeAssignment(page, quizId);
  await expect(page.getByRole("heading", { name: "Save and share these links now" })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/practice/${followupId}`);
  await expect(page.getByRole("heading", { name: "Misconception check", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private access", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.goto(genericUrl);
  await expect(page.getByText("Question 1 of 1", { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  const response = page.getByLabel("Response choices").getByRole("button").first();
  await response.scrollIntoViewIfNeeded();
  const responseTarget = await response.boundingBox();
  expect(responseTarget?.width).toBeGreaterThanOrEqual(44);
  expect(responseTarget?.height).toBeGreaterThanOrEqual(44);
  await response.click();
  await page.getByRole("button", { name: "Very sure", exact: true }).click();
  const submit = page.getByRole("button", { name: "Submit response" });
  await submit.scrollIntoViewIfNeeded();
  const submitTarget = await submit.boundingBox();
  expect(submitTarget?.width).toBeGreaterThanOrEqual(44);
  expect(submitTarget?.height).toBeGreaterThanOrEqual(44);
});

test("mobile beta creation surface passes automated accessibility checks @mobile", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  await expectNoAxeViolations(page);
});
