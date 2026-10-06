import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function fixture(page: Page, deleted: "diagnostic" | "recheck" | null = null) {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
  const title = `Pack update ${randomUUID().slice(0, 8)}`;
  const recheckId = randomUUID();
  const diagnostic = {
    id: randomUUID(),
    type: "numeric",
    prompt: "Initial diagnostic situation",
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["ratios"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Compare the part with its reference.",
    mediaId: null,
    mediaAlt: null,
    correctValue: "2",
    tolerance: "0",
    unit: null,
  };
  const content = {
    schemaVersion: 1,
    title,
    description: "Baseline context",
    diagnostic,
    recheck: {
      ...diagnostic,
      id: recheckId,
      delivery: "recheck",
      linkedRecheckQuestionId: null,
      prompt: "Initial transfer situation",
    },
    interventions: [
      { id: randomUUID(), title: "Original example", body: "Original facilitator card." },
    ],
    conceptKeys: ["ratios"],
    misconceptionKeys: [],
    citations: [],
    delayedProbe: null,
  };
  const created = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: { draft: content },
  });
  expect(created.status()).toBe(201);
  const pack = (await created.json()).pack;
  const published = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(published.ok()).toBeTruthy();
  const version = (await published.json()).version;
  const round = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: `${title} destination` },
  });
  expect(round.status()).toBe(201);
  const target = (await round.json()).quiz;
  const inserted = await page.request.post(`${apiUrl}/v1/recovery-packs/insert`, {
    data: {
      quizId: target.id,
      packVersionId: version.id,
      expectedRevision: target.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(inserted.ok()).toBeTruthy();
  const quiz = (await inserted.json()).quiz;
  const insertion = quiz.draft.recoveryPackInsertions[0];
  const localRecheck = "Locally tailored transfer situation";
  const localDraft = {
    ...quiz.draft,
    questions:
      deleted === "diagnostic"
        ? [
            ...quiz.draft.questions.filter(
              (question: { id: string }) => question.id !== insertion.diagnosticQuestionId,
            ),
            {
              ...diagnostic,
              id: randomUUID(),
              linkedRecheckQuestionId: null,
              prompt: "Unrelated local checkpoint",
            },
          ]
        : deleted === "recheck"
          ? quiz.draft.questions
              .filter((question: { id: string }) => question.id !== insertion.recheckQuestionId)
              .map((question: { id: string }) =>
                question.id === insertion.diagnosticQuestionId
                  ? { ...question, linkedRecheckQuestionId: null }
                  : question,
              )
          : quiz.draft.questions.map((question: { id: string }) =>
              question.id === insertion.recheckQuestionId
                ? { ...question, prompt: localRecheck }
                : question,
            ),
  };
  const localSaved = await page.request.put(`${apiUrl}/v1/quizzes/${target.id}/draft`, {
    data: {
      draft: localDraft,
      expectedRevision: quiz.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 1,
    },
  });
  expect(localSaved.ok()).toBeTruthy();
  const latestPrompt = "New published diagnostic situation";
  const latestCard = "New facilitator card with two contrasting examples.";
  const sourceSaved = await page.request.put(`${apiUrl}/v1/recovery-packs/${pack.id}/draft`, {
    data: {
      draft: {
        ...pack.draft,
        description: "Updated context",
        diagnostic:
          deleted === "recheck"
            ? pack.draft.diagnostic
            : { ...pack.draft.diagnostic, prompt: latestPrompt },
        recheck: { ...pack.draft.recheck, prompt: "New published transfer situation" },
        interventions: [
          { ...pack.draft.interventions[0], title: "Updated example", body: latestCard },
        ],
      },
      expectedRevision: pack.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(sourceSaved.ok()).toBeTruthy();
  const sourceRevision = (await sourceSaved.json()).pack.draftRevision;
  const latestPublished = await page.request.post(
    `${apiUrl}/v1/recovery-packs/${pack.id}/publish`,
    { data: { expectedDraftRevision: sourceRevision } },
  );
  expect(latestPublished.ok()).toBeTruthy();
  const latestVersionId = (await latestPublished.json()).version.id as string;
  await page.goto(`/quiz/${target.id}`);
  const panel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: `Review Pack updates · ${title}` }) });
  await expect(panel).toBeVisible();
  await panel.locator("summary").first().click();
  return {
    targetId: target.id as string,
    title,
    insertion,
    panel,
    localRecheck,
    latestPrompt,
    latestCard,
    latestVersionId,
  };
}

for (const profile of ["desktop", "@mobile"] as const) {
  test(`Restoring a normally deleted Pack recheck requires an explicitly linked diagnostic choice ${profile}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { targetId, panel, insertion } = await fixture(page, "recheck");
    await panel.getByRole("button", { name: "Review latest Pack version" }).click();
    await expect(panel.getByLabel("Diagnostic update choice")).toHaveValue("keep_local");
    await expect(panel.getByLabel("Recheck update choice")).toHaveValue("");
    await panel.getByLabel("Recheck update choice").selectOption("use_latest");
    const linkNotice = panel.getByRole("alert", { name: "Linked checkpoint choices" });
    await expect(linkNotice).toBeVisible();
    await expect(linkNotice).toContainText(/diagnostic/i);
    await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toBeDisabled();
    await panel.getByLabel("Diagnostic update choice").selectOption("use_latest");
    await expect(linkNotice).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toBeEnabled();
    await panel.getByRole("button", { name: "Apply reviewed Pack update" }).click();
    await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeEnabled();
    const restored = (await (await page.request.get(`${apiUrl}/v1/quizzes/${targetId}`)).json())
      .quiz;
    expect(restored.draft.questions).toHaveLength(2);
    expect(
      restored.draft.questions.find(
        (question: { id: string }) => question.id === insertion.diagnosticQuestionId,
      ).linkedRecheckQuestionId,
    ).toBe(insertion.recheckQuestionId);
    expect(
      restored.draft.questions.find(
        (question: { id: string }) => question.id === insertion.recheckQuestionId,
      ).delivery,
    ).toBe("recheck");
    const published = await page.request.post(`${apiUrl}/v1/quizzes/${targetId}/publish`, {
      data: { expectedDraftRevision: restored.draftRevision },
    });
    expect(published.ok()).toBeTruthy();
  });
}

test("Fresh Pack insertions expose readable comparisons but no invalid no-op apply", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const source = await fixture(page);
  const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: "Fresh current Pack destination" },
  });
  expect(created.ok()).toBeTruthy();
  const quiz = (await created.json()).quiz;
  const inserted = await page.request.post(`${apiUrl}/v1/recovery-packs/insert`, {
    data: {
      quizId: quiz.id,
      packVersionId: source.latestVersionId,
      expectedRevision: quiz.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(inserted.ok()).toBeTruthy();
  await page.goto(`/quiz/${quiz.id}`);
  const panel = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: `Review Pack updates · ${source.title}` }) });
  await panel.locator("summary").first().click();
  await panel.getByRole("button", { name: "Review latest Pack version" }).click();
  await expect(panel.getByText(/This insertion is already up to date/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toBeDisabled();
  await expect(panel.getByLabel("Diagnostic update choice")).toBeDisabled();
  await expect(panel.getByLabel("Recheck update choice")).toBeDisabled();
  await expect(
    panel.getByRole("heading", { name: "Accepted source baseline", exact: true }),
  ).toHaveCount(2);
});

for (const profile of ["desktop", "@mobile"] as const) {
  test(`Pack updates drain local saves, invalidate stale previews, and recover lost apply/undo acknowledgements ${profile}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { targetId, panel, insertion, localRecheck, latestPrompt, latestCard } =
      await fixture(page);
    const title = page.getByLabel("Title");
    let releasePreview!: () => void;
    let previewHasStarted = false;
    const previewGate = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    await page.route("**/v1/recovery-packs/update-review", async (route) => {
      previewHasStarted = true;
      await previewGate;
      await route.continue();
    });
    await title.fill("Pending local title before Pack review", { timeout: 5_000 });
    await panel
      .getByRole("button", { name: "Review latest Pack version" })
      .click({ timeout: 5_000 });
    await expect.poll(() => previewHasStarted).toBe(true);
    await expect(title).toBeDisabled();
    const savedBeforeReview = await page.request.get(`${apiUrl}/v1/quizzes/${targetId}`);
    expect((await savedBeforeReview.json()).quiz.draft.title).toBe(
      "Pending local title before Pack review",
    );
    releasePreview();
    await expect(panel.getByLabel("Diagnostic update choice")).toHaveValue("use_latest");
    await expect(panel.getByLabel("Recheck update choice")).toHaveValue("");
    await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toBeDisabled();
    await page.unroute("**/v1/recovery-packs/update-review");
    await title.fill("Newer local title invalidates preview");
    await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Review latest Pack version" }).click();
    await expect(panel.getByLabel("Diagnostic update choice")).toHaveValue("use_latest");
    await panel.getByLabel("Recheck update choice").selectOption("keep_local");
    const context = panel.locator("details").filter({
      has: page.locator("summary", { hasText: "Pack context comparison: baseline and latest" }),
    });
    await context.locator("summary").first().click();
    await expect(context).toContainText("Original facilitator card.");
    await expect(context).toContainText(latestCard);
    const references = panel
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "Accepted facilitator references" }) });
    await references.locator("summary").first().click();
    await expect(references).toContainText("Original facilitator card.");
    await expect(references).not.toContainText(latestCard);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    const updateBodies: string[] = [];
    let loseApply = true;
    await page.route("**/v1/recovery-packs/update", async (route) => {
      updateBodies.push(route.request().postData()!);
      if (loseApply) {
        loseApply = false;
        expect((await route.fetch()).ok()).toBeTruthy();
        await route.abort("failed");
      } else await route.continue();
    });
    await panel.getByRole("button", { name: "Apply reviewed Pack update" }).click();
    await expect(
      panel.getByRole("button", { name: "Retry Pack update acknowledgement" }),
    ).toBeEnabled();
    await panel.getByRole("button", { name: "Retry Pack update acknowledgement" }).click();
    await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeEnabled();
    expect(updateBodies).toHaveLength(2);
    expect(updateBodies[0]).toBe(updateBodies[1]);
    await expect(references).toContainText(latestCard);
    const afterApply = (await (await page.request.get(`${apiUrl}/v1/quizzes/${targetId}`)).json())
      .quiz;
    expect(afterApply.draftRevision).toBe(JSON.parse(updateBodies[0]!).expectedRevision + 1);
    expect(
      afterApply.draft.questions.find(
        (question: { id: string }) => question.id === insertion.diagnosticQuestionId,
      ).prompt,
    ).toBe(latestPrompt);
    expect(
      afterApply.draft.questions.find(
        (question: { id: string }) => question.id === insertion.recheckQuestionId,
      ).prompt,
    ).toBe(localRecheck);
    expect(afterApply.draft.recoveryPackInsertions[0].originalContent.diagnostic.prompt).toBe(
      "Initial diagnostic situation",
    );
    expect(afterApply.draft.recoveryPackInsertions[0].updateBaseline.packVersion).toBe(2);

    const undoBodies: string[] = [];
    let loseUndo = true;
    await page.route(`**/v1/quizzes/${targetId}/history/*/restore`, async (route) => {
      undoBodies.push(route.request().postData()!);
      if (loseUndo) {
        loseUndo = false;
        expect((await route.fetch()).ok()).toBeTruthy();
        await route.abort("failed");
      } else await route.continue();
    });
    await panel.getByRole("button", { name: "Undo this Pack update" }).click();
    await expect(panel.getByRole("button", { name: "Retry undo acknowledgement" })).toBeEnabled();
    await panel.getByRole("button", { name: "Retry undo acknowledgement" }).click();
    await expect(panel.getByRole("status")).toContainText("Pack update undone");
    expect(undoBodies).toHaveLength(2);
    expect(undoBodies[0]).toBe(undoBodies[1]);
    await expect(references).toContainText("Original facilitator card.");
    const afterUndo = (await (await page.request.get(`${apiUrl}/v1/quizzes/${targetId}`)).json())
      .quiz;
    expect(afterUndo.draftRevision).toBe(afterApply.draftRevision + 1);
    expect(afterUndo.draft.recoveryPackInsertions[0].updateBaseline).toBeUndefined();
    expect(afterUndo.draft.title).toBe("Newer local title invalidates preview");
  });
}

test("Pack update review restores deleted checkpoints only explicitly and disables undo after later edits", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { targetId, panel, insertion, latestPrompt } = await fixture(page, "diagnostic");
  await panel.getByRole("button", { name: "Review latest Pack version" }).click();
  await expect(panel.getByLabel("Diagnostic update choice")).toHaveValue("");
  await expect(panel.getByText("Checkpoint deleted locally.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Apply reviewed Pack update" })).toBeDisabled();
  await panel.getByLabel("Diagnostic update choice").selectOption("use_latest");
  await panel.getByRole("button", { name: "Apply reviewed Pack update" }).click();
  await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeEnabled();
  const restored = (await (await page.request.get(`${apiUrl}/v1/quizzes/${targetId}`)).json()).quiz;
  expect(restored.draft.questions).toHaveLength(3);
  expect(
    restored.draft.questions.find(
      (question: { id: string }) => question.id === insertion.diagnosticQuestionId,
    ).prompt,
  ).toBe(latestPrompt);
  await page.getByLabel("Title").fill("New work after Pack update");
  await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeDisabled();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${apiUrl}/v1/quizzes/${targetId}`)).json()).quiz.draft
          .title,
    )
    .toBe("New work after Pack update");
  await expect(panel.getByRole("button", { name: "Undo this Pack update" })).toBeDisabled();
});
