import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";
import type { FollowupSnapshot } from "@openround/contracts";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

async function publishedPack(page: Page, withProbe = true, fullSequence = false) {
  const title = `Practice Pack ${randomUUID().slice(0, 8)}`;
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "single_select",
    prompt,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["evidence"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "The observation supports this conclusion.",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Use the observed evidence", isCorrect: true },
      { id: randomUUID(), label: "Assume the outcome", isCorrect: false },
    ],
  });
  const recheck = { ...question("Hidden immediate recheck?"), delivery: "recheck" };
  const probePrompt = `Which evidence supports the later action ${randomUUID().slice(0, 8)}?`;
  const created = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: {
      draft: {
        schemaVersion: 1,
        title,
        description: "Frozen practice source",
        diagnostic: {
          ...question("Hidden source diagnostic?"),
          linkedRecheckQuestionId: recheck.id,
        },
        recheck,
        delayedProbe: withProbe ? question(probePrompt) : null,
        interventions: [
          {
            id: randomUUID(),
            title: fullSequence ? "Review the frozen evidence" : "Private facilitator card",
            body: fullSequence
              ? "<script>window.sequenceCardLeak=true</script>\nFrozen explanation: compare the evidence before rechecking."
              : "This card must not enter standalone practice.",
            citations: fullSequence
              ? [
                  {
                    sourceName: "Frozen field notes",
                    sourceDigest: "a".repeat(64),
                    locator: "p. 2",
                    excerpt: "Use observable evidence.",
                  },
                ]
              : [],
          },
          ...(fullSequence
            ? [
                {
                  id: randomUUID(),
                  title: "Apply the frozen example",
                  body: `Second frozen card: use this worked example before rechecking.\n${"LongUnbrokenEvidence".repeat(60)}`,
                  citations: [
                    {
                      sourceName: "Frozen worked example",
                      sourceDigest: "b".repeat(64),
                      locator: "p. 3",
                      excerpt: "https://frozen.example/" + "evidence".repeat(40),
                    },
                  ],
                },
              ]
            : []),
        ],
        conceptKeys: ["evidence"],
        misconceptionKeys: [],
        citations: [],
      },
    },
  });
  expect(created.status()).toBe(201);
  const pack = (await created.json()).pack;
  const published = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: 0 },
  });
  expect(published.status()).toBe(200);
  return { pack, version: (await published.json()).version, title, probePrompt };
}

async function packPracticeWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  await signInBeta(page);
  const { pack, version, title, probePrompt } = await publishedPack(page);
  await page.goto("/recovery-packs");
  await page.getByRole("button").filter({ hasText: title }).click();
  await page.getByRole("link", { name: "Assign delayed-probe practice", exact: true }).click();
  await expect(page).toHaveURL(
    `${new URL(page.url()).origin}/recovery-packs/${pack.id}/assign?version=${version.id}`,
  );
  await expect(
    page.getByRole("heading", { name: "Assign delayed-probe practice", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(probePrompt, { exact: true })).toBeVisible();
  await expect(page.getByText("Hidden immediate recheck?", { exact: true })).toHaveCount(0);
  await page.getByText("Create one-attempt personal links", { exact: true }).click();
  await page.getByLabel("One personal link label per line").fill("Partner A\nPartner B");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const bodies: string[] = [];
  let loseAcknowledgement = true;
  let receipt: {
    followup: { id: string; recoveryPackSource: { packVersionId: string } };
    genericUrl: string;
    personalAccess: { id: string; url: string; label: string }[];
  } | null = null;
  await page.route(`**/v1/recovery-packs/${pack.id}/practice-assignments`, async (route) => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    receipt = await response.json();
    if (loseAcknowledgement) {
      loseAcknowledgement = false;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create delayed-probe practice", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry assignment acknowledgement", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("heading", { name: "Save your private links" })).toHaveCount(0);
  await expect(page.getByLabel("One personal link label per line")).toBeDisabled();
  await retry.click();
  await expect(
    page.getByRole("heading", { name: "Save your private links", exact: true }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  const privateInput = JSON.parse(bodies[0]!);
  expect(privateInput.accessSeed).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await page.locator("body").innerText()).not.toContain(privateInput.accessSeed);
  const acknowledged = receipt!;
  expect(acknowledged.followup.recoveryPackSource.packVersionId).toBe(version.id);
  await expect(page.getByLabel("Generic anonymous practice link", { exact: true })).toHaveValue(
    acknowledged.genericUrl,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download links CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    `polling-pops-practice-${acknowledged.followup.id}-links.csv`,
  );

  const deleted = await page.request.delete(`${apiUrl}/v1/recovery-packs/${pack.id}`);
  expect(deleted.status()).toBe(204);
  const participantContext = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    isMobile: testInfo.project.name.includes("mobile"),
    hasTouch: testInfo.project.name.includes("mobile"),
    reducedMotion: "reduce",
  });
  try {
    const participant = await participantContext.newPage();
    const snapshots: string[] = [];
    participant.on("response", async (response) => {
      if (new URL(response.url()).pathname.endsWith("/start"))
        snapshots.push(await response.text());
    });
    await participant.goto(acknowledged.personalAccess[0]!.url);
    await expect(participant.getByRole("heading", { name: probePrompt, level: 1 })).toBeVisible();
    await expect.poll(() => snapshots.length).toBe(1);
    for (const hidden of [
      "isCorrect",
      "The observation supports this conclusion",
      "Hidden source diagnostic",
      "Hidden immediate recheck",
      "This card must not enter",
      "packVersionId",
      "recoveryPackSource",
    ])
      expect(snapshots[0]).not.toContain(hidden);
    expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
    await participant
      .getByRole("button", { name: "Use the observed evidence", exact: true })
      .click();
    await participant.getByRole("button", { name: "Submit response", exact: true }).click();
    await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
    await participant.reload();
    await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
    await participant.getByRole("button", { name: "Finish practice", exact: true }).click();
    await expect(participant.getByText("Practice complete", { exact: true })).toBeVisible();
  } finally {
    await participantContext.close();
  }

  await page.getByRole("link", { name: "Manage practice", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
  await expect(page.getByText("Published v1", { exact: true })).toBeVisible();
  await expect(page.getByText("completed", { exact: true }).locator("..")).toContainText("1");
  await expect(page.getByLabel("Generic anonymous practice link")).toHaveCount(0);
  const values = await page
    .locator("input")
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(values).not.toContain(acknowledged.genericUrl);
  expect(values).not.toContain(acknowledged.personalAccess[0]!.url);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/assignments");
  await expect(page.locator(`a[href="/practice/${acknowledged.followup.id}"]`)).toBeVisible();
}

test("Pack delayed-probe practice recovers creation, retains frozen source after deletion, and resumes accountlessly", async ({
  page,
  browser,
}, testInfo) => {
  await packPracticeWorkflow(page, browser, testInfo);
});
test("Pack delayed-probe practice remains accessible and retryable @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await packPracticeWorkflow(page, browser, testInfo);
});

async function missingProbeWorkflow(page: Page) {
  await signInBeta(page);
  const { pack, version } = await publishedPack(page, false);
  await page.goto(`/recovery-packs/${pack.id}/assign?version=${version.id}`);
  await expect(
    page.getByText(
      "This published Pack has no delayed probe. Its diagnostic and recheck are not substitutes.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create delayed-probe practice", exact: true }),
  ).toHaveCount(0);
}
test("Pack practice does not substitute an immediate checkpoint for a missing delayed probe", async ({
  page,
}) => {
  await missingProbeWorkflow(page);
});
test("Pack practice explains a missing published probe @mobile", async ({ page }) => {
  await missingProbeWorkflow(page);
});

async function fullSequenceWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  await signInBeta(page);
  const { pack, version, title } = await publishedPack(page, false, true);
  await page.goto("/recovery-packs");
  await page.getByRole("button").filter({ hasText: title }).click();
  await expect(
    page.getByRole("button", { name: "Assign delayed-probe practice", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Assign full-sequence practice", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Assign full-sequence practice", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Recovery Pack practice mode")).toHaveValue("full_sequence");
  await expect(page.getByRole("region", { name: "Frozen full-sequence preview" })).toBeVisible();
  await expect(page.getByText("Hidden source diagnostic?", { exact: true })).toBeVisible();
  await expect(page.getByText("Hidden immediate recheck?", { exact: true })).toBeVisible();
  await expect(page.getByText("Review the frozen evidence", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expect(page.getByRole("radio", { name: /Time-flex/ })).toBeChecked();
  await page.getByRole("radio", { name: /Use the published timer/ }).check();
  await page.getByText("Create one-attempt personal links", { exact: true }).click();
  await page.getByLabel("One personal link label per line").fill("Sequence learner");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/v1/recovery-packs/${pack.id}/practice-assignments`),
  );
  await page.getByRole("button", { name: "Create full-sequence practice", exact: true }).click();
  const acknowledged = await (await createResponse).json();
  expect(acknowledged.followup.recoveryPackSource).toMatchObject({
    packVersionId: version.id,
    role: "full_sequence",
    sourceItemId: version.content.diagnostic.id,
  });
  expect(acknowledged.followup.checkpointCount).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Save your private links", exact: true }),
  ).toBeVisible();
  expect((await page.request.delete(`${apiUrl}/v1/recovery-packs/${pack.id}`)).status()).toBe(204);

  const participantContext = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    isMobile: testInfo.project.name.includes("mobile"),
    hasTouch: testInfo.project.name.includes("mobile"),
    reducedMotion: "reduce",
  });
  try {
    const participant = await participantContext.newPage();
    const activate = async (name: string) => {
      const control = participant.getByRole("button", { name, exact: true });
      await expect(control).toBeVisible();
      await expect(control).toBeEnabled();
      await control.focus();
      await expect(control).toBeFocused();
      await control.press("Enter");
    };
    const frames: FollowupSnapshot[] = [];
    const answerBodies: string[] = [];
    const advanceBodies: string[] = [];
    let loseAnswer = true;
    let loseCardAdvance = true;
    let rejectNextAdvance = false;
    let failNextSnapshot = false;
    await participant.route(`**/v1/followups/${acknowledged.followup.id}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const answer = path.endsWith("/answers");
      const advance = path.endsWith("/advance");
      if (answer) answerBodies.push(route.request().postData()!);
      if (advance) advanceBodies.push(route.request().postData()!);
      if (advance && rejectNextAdvance) {
        rejectNextAdvance = false;
        await route.fulfill({
          status: 409,
          json: { error: { code: "CONFLICT", message: "Refresh the current practice state." } },
        });
        return;
      }
      if (path.endsWith("/snapshot") && failNextSnapshot) {
        failNextSnapshot = false;
        await route.fulfill({
          status: 503,
          json: {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Practice sync temporarily unavailable.",
            },
          },
        });
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(path.endsWith("/start") ? 201 : 200);
      const body = await response.json();
      if (body.snapshot) frames.push(body.snapshot);
      if ((answer && loseAnswer) || (advance && advanceBodies.length === 2 && loseCardAdvance)) {
        if (answer) loseAnswer = false;
        else loseCardAdvance = false;
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await participant.goto(acknowledged.personalAccess[0].url);
    await expect(
      participant.getByRole("heading", { name: "Hidden source diagnostic?", level: 1 }),
    ).toBeFocused();
    expect(frames[0]).toMatchObject({
      practiceMode: "full_sequence",
      phase: "question_open",
      intervention: null,
    });
    const copiedDiagnosticId = frames[0]!.question!.id;
    expect(copiedDiagnosticId).not.toBe(version.content.diagnostic.id);
    expect(frames[0]!.question!.choices.map((choice) => choice.id)).not.toEqual(
      version.content.diagnostic.choices.map((choice: { id: string }) => choice.id),
    );
    const initialFrame = JSON.stringify(frames[0]);
    for (const hidden of [
      "isCorrect",
      "Frozen explanation",
      "Second frozen card",
      "Hidden immediate recheck",
      "Frozen field notes",
      "recoveryPackSource",
    ])
      expect(initialFrame).not.toContain(hidden);
    await activate("Use the observed evidence");
    await activate("Submit response");
    await expect(
      participant.getByRole("button", { name: "Retry response acknowledgement", exact: true }),
    ).toBeVisible();
    await expect(participant.getByText("Correct", { exact: true })).toHaveCount(0);
    await expect(
      participant.getByRole("button", { name: "Submit response", exact: true }),
    ).toBeDisabled();
    await activate("Retry response acknowledgement");
    await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
    expect(answerBodies[0]).toBe(answerBodies[1]);
    expect(JSON.parse(answerBodies[0]!)).toMatchObject({
      questionId: copiedDiagnosticId,
      expectedVersion: frames[0]!.version,
    });
    await activate("Review recovery guidance");
    await expect(
      participant.getByRole("heading", { name: "Review the frozen evidence", level: 1 }),
    ).toBeFocused();
    await expect(
      participant.getByRole("region", { name: "Review the frozen evidence" }).locator('p[lang=""]'),
    ).toHaveText(version.content.interventions[0].body);
    await expect(
      participant.getByText("Frozen field notes, p. 2 — Use observable evidence.", { exact: true }),
    ).toBeVisible();
    await expect(
      participant.getByRole("heading", { name: "Hidden immediate recheck?" }),
    ).toHaveCount(0);
    await expect(participant.getByText(/Second frozen card/)).toHaveCount(0);
    await expect(participant.getByText("No countdown", { exact: true })).toBeVisible();
    const cardFrame = frames.find((frame) => frame.phase === "intervention")!;
    expect(cardFrame).toMatchObject({
      question: null,
      response: null,
      correct: null,
      correctResponse: null,
      explanation: null,
      feedback: null,
      confidence: null,
      deadline: null,
      intervention: { index: 0, count: 2, card: { id: version.content.interventions[0].id } },
    });
    expect(JSON.stringify(cardFrame)).not.toContain("Second frozen card");
    expect(JSON.stringify(cardFrame)).not.toContain("Hidden immediate recheck");
    expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
    await activate("Next guidance card");
    await expect(
      participant.getByRole("button", { name: "Retry continue acknowledgement", exact: true }),
    ).toBeVisible();
    await expect(
      participant.getByRole("heading", { name: "Review the frozen evidence", level: 1 }),
    ).toBeVisible();
    await expect(
      participant.getByRole("heading", { name: "Apply the frozen example", level: 1 }),
    ).toHaveCount(0);
    await activate("Retry continue acknowledgement");
    await expect(
      participant.getByRole("heading", { name: "Apply the frozen example", level: 1 }),
    ).toBeFocused();
    expect(
      await participant.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(advanceBodies[1]).toBe(advanceBodies[2]);
    expect(JSON.parse(advanceBodies[1]!)).toMatchObject({ expectedVersion: cardFrame.version });
    await participant.reload();
    await expect(
      participant.getByRole("heading", { name: "Apply the frozen example", level: 1 }),
    ).toBeFocused();
    await expect(
      participant.getByRole("heading", { name: "Hidden immediate recheck?" }),
    ).toHaveCount(0);
    const resumedCard = frames.at(-1)!;
    expect(resumedCard).toMatchObject({
      phase: "intervention",
      deadline: null,
      question: null,
      intervention: { index: 1 },
    });
    rejectNextAdvance = true;
    failNextSnapshot = true;
    await activate("Continue to recheck");
    await expect(
      participant.getByRole("button", { name: "Retry practice sync", exact: true }),
    ).toBeEnabled();
    await expect(
      participant.getByRole("button", { name: "Continue to recheck", exact: true }),
    ).toBeDisabled();
    await expect(
      participant.getByRole("button", { name: "Retry continue acknowledgement", exact: true }),
    ).toHaveCount(0);
    const attemptsBeforeSync = advanceBodies.length;
    await activate("Retry practice sync");
    await expect(
      participant.getByRole("button", { name: "Continue to recheck", exact: true }),
    ).toBeEnabled();
    await expect(
      participant.getByRole("button", { name: "Retry practice sync", exact: true }),
    ).toHaveCount(0);
    expect(advanceBodies).toHaveLength(attemptsBeforeSync);
    await activate("Continue to recheck");
    await expect(
      participant.getByRole("heading", { name: "Hidden immediate recheck?", level: 1 }),
    ).toBeFocused();
    const recheck = frames.at(-1)!;
    expect(recheck).toMatchObject({
      phase: "question_open",
      intervention: null,
      question: { prompt: "Hidden immediate recheck?" },
      questionIndex: 1,
      questionCount: 2,
    });
    expect(recheck.question!.id).not.toBe(version.content.recheck.id);
    expect(recheck.question!.id).not.toBe(copiedDiagnosticId);
    expect(new Date(recheck.deadline!).getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(JSON.stringify(recheck)).not.toContain("Frozen explanation");
    await activate("Use the observed evidence");
    await activate("Submit response");
    await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
    await activate("Finish practice");
    await expect(participant.getByText("Practice complete", { exact: true })).toBeVisible();
    await expect(
      participant.getByRole("heading", {
        name: "Thanks for checking your understanding.",
        level: 1,
      }),
    ).toBeFocused();
    expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
  } finally {
    await participantContext.close();
  }
  await page.getByRole("link", { name: "Manage practice", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
  await expect(page.getByText(/Frozen Recovery Pack full sequence/)).toBeVisible();
  await expect(page.getByText("completed", { exact: true }).locator("..")).toContainText("1");
}

test("Full-sequence Pack practice freezes active private frames, replays lost answer/card receipts, and resumes after source deletion", async ({
  page,
  browser,
}, testInfo) => {
  await fullSequenceWorkflow(page, browser, testInfo);
});
test("Full-sequence Pack practice passes automated accessibility and keyboard receipt recovery @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await fullSequenceWorkflow(page, browser, testInfo);
});
