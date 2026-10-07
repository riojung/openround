import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

async function publishedPack(page: Page, withProbe = true) {
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
            title: "Private facilitator card",
            body: "This card must not enter standalone practice.",
            citations: [],
          },
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
    `openround-practice-${acknowledged.followup.id}-links.csv`,
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
