import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function recoveryPackWorkflow(page: Page) {
  test.setTimeout(120_000);
  await page.goto("/signin");
  const education = page.getByRole("button", { name: "Education" });
  await expect(education).toBeEnabled();
  await education.click();
  await expect(education).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Email address").fill("ux-beta-e2e@example.com");
  const policyConsent = page.getByLabel(/I accept the Terms/);
  await policyConsent.check();
  await expect(policyConsent).toBeChecked();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  // A matching URL can precede the completed auth redirect and interrupt the next navigation.
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/dashboard" && url.searchParams.get("welcome") === "1",
      { waitUntil: "load" },
    ),
    page.getByRole("link", { name: "Continue to dashboard" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();

  const sourceTitle = `Pack source ${randomUUID().slice(0, 8)}`;
  const diagnosticId = randomUUID();
  const recheckId = randomUUID();
  const diagnostic = {
    id: diagnosticId,
    type: "numeric",
    prompt: "A ratio compares 2 parts with 4 parts. What is the ratio?",
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["ratios"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Divide the compared part by the reference part.",
    mediaId: null,
    mediaAlt: null,
    correctValue: "0.5",
    tolerance: "0",
    unit: null,
  };
  const created = await page.request.post(`${apiUrl}/v1/quizzes`, { data: { title: sourceTitle } });
  expect(created.status()).toBe(201);
  const source = (await created.json()).quiz as { id: string; draftRevision: number };
  const saved = await page.request.patch(`${apiUrl}/v1/quizzes/${source.id}`, {
    data: {
      expectedDraftRevision: source.draftRevision,
      draft: {
        title: sourceTitle,
        description: "Published source",
        questions: [
          diagnostic,
          {
            ...diagnostic,
            id: recheckId,
            delivery: "recheck",
            linkedRecheckQuestionId: null,
            prompt: "A new diagram compares 3 parts with 12 parts. What is the ratio?",
            correctValue: "0.25",
          },
        ],
      },
    },
  });
  expect(saved.ok()).toBeTruthy();
  const publishedSource = await page.request.post(`${apiUrl}/v1/quizzes/${source.id}/publish`, {
    data: {},
  });
  expect(publishedSource.ok()).toBeTruthy();
  const targetTitle = `Pack destination ${randomUUID().slice(0, 8)}`;
  const targetResponse = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: targetTitle },
  });
  expect(targetResponse.status()).toBe(201);
  const target = (await targetResponse.json()).quiz as { id: string };

  await page.goto("/library");
  await page.getByRole("link", { name: "Recovery Packs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recovery Packs", exact: true })).toBeVisible();
  await page.getByLabel("Source Round").selectOption(source.id, { timeout: 10_000 });
  await page.getByLabel("Diagnostic and linked recheck").selectOption(diagnosticId);
  await page.getByRole("button", { name: "Create Pack draft" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(sourceTitle);
  const title = `Ratios recovery ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  const guidance = "Draw two contrasting ratios and explain which quantity is the reference.";
  await page.getByLabel("Card 1 facilitator guidance").fill(guidance);
  const saveMutationIds: string[] = [];
  let loseSaveAcknowledgement = true;
  await page.route("**/v1/recovery-packs/*/draft", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    saveMutationIds.push(route.request().postDataJSON().mutationId as string);
    if (loseSaveAcknowledgement) {
      loseSaveAcknowledgement = false;
      const accepted = await route.fetch();
      expect(accepted.ok()).toBeTruthy();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator("p.error[role=alert]")).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  expect(saveMutationIds).toHaveLength(2);
  expect(saveMutationIds[0]).toBe(saveMutationIds[1]);
  await expect(page.getByRole("button", { name: "Publish saved draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish saved draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pack published" })).toBeVisible();
  const destination = page.getByLabel("Destination Round draft");
  const unsafeId = '<img src=x onerror="alert(1)">';
  await destination.evaluate((select, value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = "Invalid destination";
    select.append(option);
  }, unsafeId);
  await destination.selectOption(unsafeId);
  await expect(page.getByRole("link", { name: "Open destination Round builder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Insert into Round draft" })).toBeDisabled();
  await page.getByLabel("Destination Round draft").selectOption(target.id);
  await expect(page.getByRole("link", { name: "Open destination Round builder" })).toHaveAttribute(
    "href",
    `/quiz/${target.id}`,
  );
  await page.getByRole("button", { name: "Insert into Round draft" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published Pack inserted" }),
  ).toBeVisible();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export OpenRound JSON" }).click();
  expect((await exported).suggestedFilename()).toContain("Ratios-recovery");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Open destination Round builder" }).click();
  const references = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Recovery Pack facilitator references:" }) });
  await expect(references).toBeVisible();
  await references.locator("summary").click();
  await expect(references).toContainText(guidance);
  await expect(references).toContainText("Live card playback is not available yet.");

  // Simulate the UI flag being disabled while preserving real authenticated resource reads.
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: {
        ...account,
        productFeatures: {
          ...account.productFeatures,
          recoveryPacks: false,
          workspaceShell: false,
          uxBeta: false,
        },
      },
    });
  });
  await page.goto("/recovery-packs");
  await expect(
    page.getByText("Pack authoring is not enabled for this workspace.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByLabel("Card 1 facilitator guidance")).toHaveValue(guidance);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create Pack draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export OpenRound JSON" })).toBeEnabled();
  const disabledExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export OpenRound JSON" }).click();
  await disabledExport;
  await expect(page.getByRole("button", { name: "Reload saved draft" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Delete Pack permanently" })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Pack permanently" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pack deleted." })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
  const preservedTarget = await page.request.get(`${apiUrl}/v1/quizzes/${target.id}`);
  expect(preservedTarget.ok()).toBeTruthy();
  const { quiz } = await preservedTarget.json();
  expect(quiz.draft.questions).toHaveLength(2);
  expect(quiz.draft.recoveryPackInsertions[0].originalContent.interventions[0].body).toBe(guidance);
}

test("Recovery Pack published-source authoring, insertion, and disabled-rollout readability", async ({
  page,
}) => {
  await recoveryPackWorkflow(page);
});

test("Recovery Pack authoring and disabled-rollout readability @mobile", async ({ page }) => {
  await recoveryPackWorkflow(page);
});
