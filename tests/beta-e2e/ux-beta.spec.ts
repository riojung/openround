import { expect, test, type Page } from "@playwright/test";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const betaEmail = "ux-beta-e2e@example.com";

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Education" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "Create Round", exact: true }).first()).toBeVisible();
}

test("creator starts a blank Round with the selected first response type", async ({ page }) => {
  await signIn(page, betaEmail);

  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  await page.getByLabel("Round title").fill("Beta blank Round");
  await page.getByRole("radio", { name: /^Number/ }).check();

  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/quizzes",
  );
  await page.getByRole("button", { name: "Create Round and write question" }).click();
  expect((await creation).status()).toBe(201);
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
  await expect(page.getByLabel("Title")).toHaveValue("Beta blank Round");
  await expect(page.getByLabel("Question prompt")).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Selected question editor" }).locator(".status-pill"),
  ).toContainText("Numeric response");
});

test("direct beta pages fail closed when account features cannot be established", async ({
  page,
}) => {
  await signIn(page, betaEmail);

  await page.route(
    "**/v1/auth/me",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: { message: "Account lookup unavailable." } }),
        contentType: "application/json",
        status: 503,
      });
    },
    { times: 1 },
  );
  await page.goto("/sessions");
  await expect(page).toHaveURL(/\/dashboard/);

  await page.route(
    "**/v1/auth/me",
    async (route) => {
      const response = await route.fetch();
      const account = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...account, productFeatures: null } });
    },
    { times: 1 },
  );
  await page.goto("/results");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/signin/);
});

test("viewer template access remains read-only", async ({ page }) => {
  await signIn(page, betaEmail);
  await page.route(
    "**/v1/auth/me",
    async (route) => {
      const response = await route.fetch();
      const account = (await response.json()) as {
        creator: Record<string, unknown>;
        [key: string]: unknown;
      };
      await route.fulfill({
        response,
        json: { ...account, creator: { ...account.creator, role: "viewer" } },
      });
    },
    { times: 1 },
  );

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start blank" })).toHaveCount(0);
  await expect(page.getByText("Viewers can browse starters.").first()).toBeVisible();
});

test("starter rehearsal exposes eligibility and creates no session or report", async ({ page }) => {
  await signIn(page, betaEmail);

  const beforeSessions = await page.request.get(`${apiUrl}/v1/sessions`);
  const beforeReports = await page.request.get(`${apiUrl}/v1/reports`);
  expect(beforeSessions.ok()).toBeTruthy();
  expect(beforeReports.ok()).toBeTruthy();
  expect((await beforeSessions.json()).items).toHaveLength(0);
  expect((await beforeReports.json()).items).toHaveLength(0);

  await page.goto("/create");
  const starterCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Misconception check", exact: true }),
  });
  await expect(starterCard).toBeVisible();
  const starterCreation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/starters/misconception-check/use",
  );
  await starterCard.getByRole("button", { name: "Use this starter" }).click();
  expect((await starterCreation).status()).toBe(201);
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
  const quizId = new URL(page.url()).pathname.split("/").at(-1);
  expect(quizId).toBeTruthy();

  await page.goto(`/quiz/${quizId}/rehearse`);
  await expect(page.getByTestId("rehearsal-setup")).toBeVisible();
  const confidentMisconception = page.getByTestId("rehearsal-scenario-confident_misconception");
  await expect(confidentMisconception).toHaveAttribute("data-eligible", "true");
  await confidentMisconception.getByRole("radio").check();
  await page.getByTestId("rehearsal-start").click();
  await expect(page.getByTestId("rehearsal-step")).toHaveAttribute("data-stage", "briefing");
  await expect(page.getByText(/synthetic learners/i).first()).toBeVisible();

  const afterSessions = await page.request.get(`${apiUrl}/v1/sessions`);
  const afterReports = await page.request.get(`${apiUrl}/v1/reports`);
  expect(afterSessions.ok()).toBeTruthy();
  expect(afterReports.ok()).toBeTruthy();
  expect((await afterSessions.json()).items).toHaveLength(0);
  expect((await afterReports.json()).items).toHaveLength(0);
});

test("signed-in creator replaces one stale host credential and resumes", async ({ page }) => {
  await signIn(page, betaEmail);

  const starterResponse = await page.request.post(`${apiUrl}/v1/starters/misconception-check/use`, {
    data: {},
  });
  expect(starterResponse.status()).toBe(201);
  const quizId = (await starterResponse.json()).quiz.id as string;
  const publishResponse = await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(publishResponse.ok()).toBeTruthy();
  const sessionResponse = await page.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    },
  });
  expect(sessionResponse.status()).toBe(201);
  const session = (await sessionResponse.json()) as { sessionId: string; code: string };
  const storageKey = `openround:host:${session.sessionId}`;
  await page.evaluate(({ key }) => sessionStorage.setItem(key, "stale-host-credential"), {
    key: storageKey,
  });

  let controlPassRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/v1/sessions/${session.sessionId}/control-pass`
    ) {
      controlPassRequests += 1;
    }
  });
  const controlPassResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/sessions/${session.sessionId}/control-pass`,
  );
  await page.goto(`/host/${session.sessionId}`);
  expect((await controlPassResponse).status()).toBe(201);
  await expect(page.locator(".session-code")).toContainText(session.code);

  const audienceTrigger = page.getByRole("button", { name: "Audience", exact: true });
  await audienceTrigger.click();
  const audienceDialog = page.getByRole("dialog", { name: "Participants and conversation" });
  await expect(audienceDialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close audience tools" })).toBeFocused();
  await expect(page.locator("header.live-topbar")).toHaveAttribute("inert", "");
  await expect(page.locator("main#main")).toHaveAttribute("inert", "");

  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest("[role=dialog]")?.id ?? null))
    .toBe("host-audience-drawer");
  await page.keyboard.press("Escape");
  await expect(audienceTrigger).toBeFocused();
  await expect(page.locator("header.live-topbar")).not.toHaveAttribute("inert", "");
  await expect(page.locator("main#main")).not.toHaveAttribute("inert", "");

  await expect
    .poll(() => page.evaluate(({ key }) => sessionStorage.getItem(key), { key: storageKey }))
    .not.toBe("stale-host-credential");
  expect(controlPassRequests).toBe(1);
});
