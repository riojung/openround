import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const webUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_WEB_PORT ?? 3200)}`;
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

async function joinParticipant(browser: Browser, code: string) {
  const context = await browser.newContext({ baseURL: webUrl, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`/join?code=${code}`);
  await expect(page.getByTestId("friendly-alias-notice")).toBeVisible();
  await expect(page.getByLabel("Nickname")).toHaveCount(0);
  const defaultAvatar = page.getByRole("radio", { name: "Comet", exact: true });
  await expect(defaultAvatar).toBeChecked();
  const target = await page.getByTestId("avatar-option-comet").boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await defaultAvatar.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Fox", exact: true })).toBeChecked();
  await page
    .getByTestId("avatar-option-owl")
    .getByText("Owl", { exact: true })
    .click({ timeout: 10_000 });
  await expect(page.getByRole("radio", { name: "Owl", exact: true })).toBeChecked();
  const joinRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/v1/sessions/join",
  );
  await page.getByRole("button", { name: "Join round" }).click();
  expect((await joinRequest).postDataJSON()).toEqual({ code, avatarId: "owl" });
  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByRole("img", { name: "Owl avatar" })).toBeVisible();
  return { context, page };
}

async function submitChoice(page: Page, choice: string) {
  await page.getByRole("button", { name: choice, exact: true }).click();
  await expect(page.getByText("Answer received and saved.")).toHaveCount(0);
  await page.getByRole("button", { name: "Very sure" }).click();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByText("Answer received and saved.")).toBeVisible();
}

async function advanceRehearsal(page: Page, from: string, buttonName: string, to: string) {
  const rehearsal = page.getByTestId("rehearsal-step");
  await expect(rehearsal).toHaveAttribute("data-stage", from);
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await expect(rehearsal).toHaveAttribute("data-stage", to);
}

function waitForCreationEvent(
  page: Page,
  name: "creation_started" | "creation_completed",
  creationPath: "source" | "import",
) {
  return page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      new URL(response.url()).pathname !== "/v1/product-events"
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as {
      events?: Array<{ name?: string; dimensions?: { creationPath?: string } }>;
    };
    const event = body.events?.[0];
    return event?.name === name && event.dimensions?.creationPath === creationPath;
  });
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

test("direct beta pages fail closed when the account lookup is unavailable", async ({ page }) => {
  await signIn(page, betaEmail);

  await page.route("**/v1/auth/me", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { message: "Account lookup unavailable." } }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.goto("/sessions");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/signin/);
});

test("direct beta pages fail closed when product features are missing", async ({ page }) => {
  await signIn(page, betaEmail);

  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...account, productFeatures: null } });
  });
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

test("starter rehearsal completes privately with bounded telemetry", async ({ page }) => {
  await signIn(page, betaEmail);

  const beforeSessions = await page.request.get(`${apiUrl}/v1/sessions`);
  const beforeReports = await page.request.get(`${apiUrl}/v1/reports`);
  expect(beforeSessions.ok()).toBeTruthy();
  expect(beforeReports.ok()).toBeTruthy();
  const sessionsBeforeRehearsal = (await beforeSessions.json()).items;
  const reportsBeforeRehearsal = (await beforeReports.json()).items;

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

  await advanceRehearsal(page, "briefing", "Start round", "question_open");
  await advanceRehearsal(page, "question_open", "Collect synthetic responses", "responses");
  await advanceRehearsal(page, "responses", "Lock answers", "diagnosis");
  await advanceRehearsal(page, "diagnosis", "Reveal answer", "revealed");
  await advanceRehearsal(page, "revealed", "Address the misconception", "intervention");
  await advanceRehearsal(page, "intervention", "Finish intervention", "verify");
  await advanceRehearsal(page, "verify", "Open linked recheck", "recheck");

  const completion = page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      new URL(response.url()).pathname !== "/v1/product-events"
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as {
      events?: Array<{ name?: string }>;
    };
    return body.events?.[0]?.name === "rehearsal_completed";
  });
  await advanceRehearsal(page, "recheck", "Lock answers", "debrief");
  const completionResponse = await completion;
  expect(completionResponse.status()).toBe(202);
  expect(completionResponse.request().postDataJSON()).toEqual({
    events: [
      {
        name: "rehearsal_completed",
        occurredAt: expect.any(String),
        dimensions: {
          scenario: "confident_misconception",
          durationBucket: "under_1m",
        },
      },
    ],
  });
  await expect(page.getByTestId("rehearsal-debrief")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /3 of 4 initially wrong synthetic learners recovered/i,
    }),
  ).toBeVisible();

  const afterSessions = await page.request.get(`${apiUrl}/v1/sessions`);
  const afterReports = await page.request.get(`${apiUrl}/v1/reports`);
  expect(afterSessions.ok()).toBeTruthy();
  expect(afterReports.ok()).toBeTruthy();
  expect((await afterSessions.json()).items).toEqual(sessionsBeforeRehearsal);
  expect((await afterReports.json()).items).toEqual(reportsBeforeRehearsal);

  const metrics = await page.request.get(`${apiUrl}/metrics`);
  expect(metrics.ok()).toBeTruthy();
  expect(await metrics.text()).toContain(
    'name="rehearsal_completed",creation_path="none",recipe="none",scenario="confident_misconception",segment="education",beta_version="p0-2026",duration_bucket="under_1m"',
  );
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

test("creator and participants complete a beta Recovery loop through report", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
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

  const participants: Array<{ context: BrowserContext; page: Page }> = [];
  try {
    await page.goto(`/host/${session.sessionId}`);
    await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
    for (let index = 0; index < 5; index += 1) {
      participants.push(await joinParticipant(browser, session.code));
    }
    await expect(
      page.locator(".room-readiness span").filter({ hasText: "joined" }).getByText("5"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Participant roster" })
        .getByRole("img", { name: "Owl avatar" }),
    ).toHaveCount(5);

    await page.getByRole("button", { name: "Start round" }).click();
    await Promise.all(
      participants.map(({ page: participant }) =>
        submitChoice(participant, "Replace with the common misconception"),
      ),
    );

    await participants[0]!.page.reload();
    await expect(participants[0]!.page.getByText("Answer received and saved.")).toBeVisible();
    await expect(
      participants[0]!.page.getByRole("button", {
        name: "Replace with the common misconception",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Lock answers" }).click();
    const distribution = page.getByRole("region", { name: "Post-lock response distribution" });
    await expect(distribution).toContainText("5 respondents");
    await expect(distribution).toContainText("Replace with the common misconception");
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await expect(page.getByText("Address the confident misconception")).toBeVisible();
    await page.getByRole("button", { name: "Address the misconception" }).click();
    await expect(page.getByText(/Active intervention: explain/)).toBeVisible();
    await page.getByRole("button", { name: "Finish intervention" }).click();
    await page.getByRole("button", { name: "Open linked recheck" }).click();

    await Promise.all(
      participants.map(({ page: participant }, index) =>
        submitChoice(
          participant,
          index === participants.length - 1
            ? "Replace with the misconception applied again"
            : "Replace with the transfer case",
        ),
      ),
    );
    await page.getByRole("button", { name: "Lock answers" }).click();
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.getByRole("button", { name: "Continue after recheck" }).click();
    await expect(page.getByText("Results are ready.")).toBeVisible();
    await page.getByTestId("host-stage").getByRole("link", { name: "Open report" }).click();

    await expect(page.getByRole("heading", { name: "Recovery evidence" }).last()).toBeVisible({
      timeout: 20_000,
    });
    const recoveryRow = page.getByRole("row", { name: /Linked recheck/ });
    await expect(recoveryRow).toContainText("4");
    await expect(recoveryRow).toContainText("5");
    await expect(
      page
        .getByRole("list", { name: "Intervention timeline" })
        .getByText("explain", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Self-paced follow-up" })).toBeVisible();
    await expect(page.getByText(/Signed follow-up links.*Hosted Pro/s)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download CSV" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Questions" }).click();
    const questionsPanel = page.getByRole("tabpanel", { name: "Questions" });
    await questionsPanel.getByText("5 respondents").first().click();
    await expect(
      questionsPanel.getByText(/Replace with the common misconception: 5 \(100%/),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Manage data" }).click();
    const managePanel = page.getByRole("tabpanel", { name: "Manage data" });
    await expect(managePanel.getByRole("heading", { name: "Export report data" })).toBeVisible();
    await expect(managePanel.getByRole("link", { name: "CSV export requires Pro" })).toBeVisible();
    await expect(managePanel.getByRole("heading", { name: "Delete session data" })).toBeVisible();
  } finally {
    await Promise.all(participants.map(({ context }) => context.close()));
  }
});

test("every remaining response type requires explicit Submit before it is saved", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, betaEmail);

  const commonQuestion = () => ({
    id: randomUUID(),
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 60,
    basePoints: 1_000,
    explanation: "Review the response together.",
    mediaId: null,
    mediaAlt: null,
  });
  const choice = (label: string, isCorrect: boolean) => ({
    id: randomUUID(),
    label,
    isCorrect,
  });
  const draft = {
    title: "Explicit submit response matrix",
    description: "Browser coverage for every remaining response type.",
    category: "education",
    experiencePreset: { id: "focus", version: 1 },
    questions: [
      {
        ...commonQuestion(),
        type: "true_false",
        prompt: "Explicit submit true or false",
        choices: [choice("True", true), choice("False", false)],
      },
      {
        ...commonQuestion(),
        type: "multi_select",
        prompt: "Explicit submit multiple choice",
        choices: [choice("Alpha", true), choice("Beta", true), choice("Gamma", false)],
      },
      {
        ...commonQuestion(),
        type: "numeric",
        prompt: "Explicit submit number",
        correctValue: "42",
        tolerance: "0",
        unit: null,
      },
      {
        ...commonQuestion(),
        type: "rating",
        prompt: "Explicit submit rating",
        purpose: "opinion",
        basePoints: 0,
        min: 1,
        max: 5,
        minLabel: "Low",
        maxLabel: "High",
      },
      {
        ...commonQuestion(),
        type: "poll",
        prompt: "Explicit submit poll",
        purpose: "opinion",
        basePoints: 0,
        choices: [choice("Option A", false), choice("Option B", false)],
      },
    ],
  };

  const quizResponse = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: draft.title, description: draft.description },
  });
  expect(quizResponse.status()).toBe(201);
  const quizId = (await quizResponse.json()).quiz.id as string;
  const updateResponse = await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: draft,
  });
  expect(updateResponse.ok()).toBeTruthy();
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

  const participant = await joinParticipant(browser, session.code);
  try {
    await page.goto(`/host/${session.sessionId}`);
    await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
    await page.getByRole("button", { name: "Start round" }).click();

    const answeredCount = page
      .locator(".room-readiness span")
      .filter({ hasText: "answered" })
      .locator("strong");
    const responseCases: Array<{
      prompt: string;
      choose: (participantPage: Page) => Promise<void>;
    }> = [
      {
        prompt: "Explicit submit true or false",
        choose: async (participantPage) => {
          const answer = participantPage.getByRole("button", { name: "True", exact: true });
          await answer.click();
          await expect(answer).toHaveAttribute("aria-pressed", "true");
        },
      },
      {
        prompt: "Explicit submit multiple choice",
        choose: async (participantPage) => {
          const alpha = participantPage.getByRole("button", { name: "Alpha", exact: true });
          const beta = participantPage.getByRole("button", { name: "Beta", exact: true });
          await alpha.click();
          await beta.click();
          await expect(alpha).toHaveAttribute("aria-pressed", "true");
          await expect(beta).toHaveAttribute("aria-pressed", "true");
        },
      },
      {
        prompt: "Explicit submit number",
        choose: async (participantPage) => {
          const input = participantPage.getByLabel(/^Numeric response/);
          await input.fill("42");
          await expect(input).toHaveValue("42");
        },
      },
      {
        prompt: "Explicit submit rating",
        choose: async (participantPage) => {
          const rating = participantPage.getByRole("button", { name: "4", exact: true });
          await rating.click();
          await expect(rating).toHaveAttribute("aria-pressed", "true");
        },
      },
      {
        prompt: "Explicit submit poll",
        choose: async (participantPage) => {
          const option = participantPage.getByRole("button", { name: "Option A", exact: true });
          await option.click();
          await expect(option).toHaveAttribute("aria-pressed", "true");
        },
      },
    ];

    for (const [index, responseCase] of responseCases.entries()) {
      await expect(
        participant.page.getByRole("heading", { name: responseCase.prompt, level: 1 }),
      ).toBeVisible();
      await expect(answeredCount).toHaveText("0");
      await responseCase.choose(participant.page);
      await expect(participant.page.getByText("Answer received and saved.")).toHaveCount(0);
      await expect(answeredCount).toHaveText("0");

      const submit = participant.page.getByRole("button", { name: "Submit response" });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(participant.page.getByText("Answer received and saved.")).toBeVisible();
      await expect(answeredCount).toHaveText("1");

      await page.getByRole("button", { name: "Lock answers" }).click();
      await page.getByRole("button", { name: "Reveal answer" }).click();
      await page
        .getByRole("button", {
          name: index === responseCases.length - 1 ? "Finish round" : "Next question",
        })
        .click();
    }
    await expect(page.getByText("Results are ready.")).toBeVisible();
  } finally {
    await participant.context.close();
  }
});

test("source and import starts reach real review drafts through mocked external gates", async ({
  page,
}) => {
  await signIn(page, betaEmail);

  const createReviewDraft = async (title: string) => {
    const response = await page.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title, description: "Browser creation-start fixture." },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).quiz.id as string;
  };
  const sourceQuizId = await createReviewDraft("Source review draft");
  const importQuizId = await createReviewDraft("Imported review draft");

  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = (await response.json()) as {
      entitlements: Record<string, unknown>;
      [key: string]: unknown;
    };
    await route.fulfill({
      response,
      json: {
        ...account,
        entitlements: { ...account.entitlements, csvExport: true },
      },
    });
  });
  await page.route("**/v1/authoring/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { status: { enabled: true, monthlyLimit: 3, used: 0, remaining: 3 } },
      status: 200,
    });
  });

  const jobId = randomUUID();
  const sourceQuestionId = randomUUID();
  const readyJob = {
    id: jobId,
    sourceName: "Fixture source",
    sourceType: "pasted_text",
    status: "ready",
    attempts: 1,
    error: null,
    appliedQuizId: null,
    output: {
      checkpointSet: {
        title: "Source review draft",
        questions: [
          {
            id: sourceQuestionId,
            delivery: "main",
            prompt: "Which statement is supported by the fixture source?",
          },
        ],
      },
      citations: [],
      provider: "Playwright fixture",
      model: "deterministic",
    },
  };
  let sourceSubmitted = false;
  let sourcePayload: Record<string, unknown> | null = null;
  await page.route("**/v1/authoring/jobs", async (route) => {
    if (route.request().method() === "POST") {
      sourcePayload = route.request().postDataJSON() as Record<string, unknown>;
      sourceSubmitted = true;
      await route.fulfill({
        contentType: "application/json",
        json: { job: readyJob },
        status: 202,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { jobs: sourceSubmitted ? [readyJob] : [] },
      status: 200,
    });
  });
  await page.route(`**/v1/authoring/jobs/${jobId}/apply`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { quiz: { id: sourceQuizId, title: "Source review draft" } },
      status: 201,
    });
  });

  await page.goto("/create#source");
  await expect(page.getByLabel("Trusted source text")).toBeVisible();
  await page.getByLabel("Source name").fill("Fixture source");
  await page
    .getByLabel("Trusted source text")
    .fill(
      "This deterministic source contains enough grounded material to propose one question and a review draft.",
    );
  const sourceStarted = waitForCreationEvent(page, "creation_started", "source");
  await page.getByRole("button", { name: "Create review proposal" }).click();
  expect((await sourceStarted).status()).toBe(202);
  expect(sourcePayload).toEqual({
    sourceType: "pasted_text",
    sourceName: "Fixture source",
    text: "This deterministic source contains enough grounded material to propose one question and a review draft.",
  });
  const proposal = page.getByRole("article").filter({ hasText: "Fixture source" });
  await expect(proposal.getByText("Ready to review")).toBeVisible();
  const sourceCompleted = waitForCreationEvent(page, "creation_completed", "source");
  await proposal.getByRole("button", { name: "Create unpublished review draft" }).click();
  expect((await sourceCompleted).status()).toBe(202);
  await expect(page).toHaveURL(new RegExp(`/quiz/${sourceQuizId}$`));
  await expect(page.getByLabel("Title")).toHaveValue("Source review draft");

  let importPayload: Record<string, unknown> | null = null;
  await page.route("**/v1/quizzes/import", async (route) => {
    importPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      json: {
        quiz: { id: importQuizId, title: "Imported review draft" },
        validation: {
          format: "bulk",
          importedCheckpoints: 1,
          errors: [],
          warnings: [],
        },
      },
      status: 201,
    });
  });
  await page.goto("/create#import");
  await page.getByLabel("Import format").selectOption("bulk");
  await page.getByLabel("New Round title (optional)").fill("Imported review draft");
  const bulkContent =
    "Which action is safest?\n* Follow the complete procedure\n- Take an undocumented shortcut";
  await page.getByLabel("Import content").fill(bulkContent);
  const importStarted = waitForCreationEvent(page, "creation_started", "import");
  const importCompleted = waitForCreationEvent(page, "creation_completed", "import");
  await page.getByRole("button", { name: "Validate and import draft" }).click();
  expect((await importStarted).status()).toBe(202);
  expect((await importCompleted).status()).toBe(202);
  expect(importPayload).toEqual({
    format: "bulk",
    data: bulkContent,
    encoding: "text",
    title: "Imported review draft",
  });
  await expect(page).toHaveURL(new RegExp(`/quiz/${importQuizId}$`));
  await expect(page.getByLabel("Title")).toHaveValue("Imported review draft");
});

test("@mobile beta creation remains usable at 390 by 844", async ({ page }) => {
  await signIn(page, betaEmail);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  await page.getByRole("link", { name: /Start blank/ }).click();
  await expect(page.getByRole("heading", { name: "Start a blank Round" })).toBeInViewport();
  const title = page.getByLabel("Round title");
  await title.scrollIntoViewIfNeeded();
  await expect(title).toBeInViewport();
  const create = page.getByRole("button", { name: "Create Round and write question" });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
