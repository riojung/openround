import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Education" }).click();
  await page.getByLabel("Email address").fill("presentation-layout-e2e@example.com");
  const policyConsent = page.getByLabel(/I accept the Terms/);
  await policyConsent.click();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function createPresentation(page: Page) {
  const response = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: "Layout editing acceptance", description: "" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).presentation.id as string;
}

test("authors can place text, save, undo/redo, preview, and publish the same slide layout", async ({
  page,
}) => {
  await signIn(page);
  const presentationId = await createPresentation(page);
  await page.goto(`/presentation/${presentationId}`);

  const canvas = page.locator("#presentation-canvas");
  const title = canvas.getByLabel("Slide title", { exact: true });
  await expect(title).toBeVisible();
  await title.fill("Training and recovery");
  await canvas
    .getByLabel("Selected block actions")
    .getByRole("button", { name: "Add text box", exact: true })
    .click();
  await canvas.getByLabel("Text box 2", { exact: true }).fill("Set the context before responding.");

  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  await page.getByRole("combobox", { name: "Selected text element" }).selectOption({
    label: "Text box 2",
  });
  await page.getByRole("combobox", { name: "Position on slide" }).selectOption("top_left");
  await expect(canvas.getByRole("group", { name: "Text box 2, Top left" })).toBeVisible();

  await canvas
    .getByRole("button", { name: "Move Slide title. Use arrow keys to change position." })
    .focus();
  await page.keyboard.press("ArrowDown");
  await expect(canvas.getByRole("group", { name: "Slide title, Bottom center" })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(canvas.getByRole("group", { name: "Slide title, Center" })).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(canvas.getByRole("group", { name: "Slide title, Bottom center" })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const savedResponse = await page.request.get(`${apiUrl}/v1/presentations/${presentationId}`);
  expect(savedResponse.ok()).toBeTruthy();
  const saved = (await savedResponse.json()).presentation;
  expect(saved.draft.schemaVersion).toBe(2);
  expect(saved.draft.blocks[0].textElements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "title",
        text: "Training and recovery",
        region: "bottom_center",
      }),
      expect.objectContaining({
        role: "body",
        text: "Set the context before responding.",
        region: "top_left",
      }),
    ]),
  );

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Presentation preview" });
  await expect(preview.getByRole("heading", { name: "Training and recovery" })).toBeVisible();
  await expect(preview.getByText("Set the context before responding.")).toBeVisible();
  await page.getByRole("button", { name: "Close preview", exact: true }).click();

  const questionId = randomUUID();
  const publishDraft = {
    ...saved.draft,
    blocks: [
      ...saved.draft.blocks,
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: questionId,
          type: "single_select",
          prompt: "What should the audience review first?",
          choices: [
            { id: randomUUID(), label: "The evidence", isCorrect: true },
            { id: randomUUID(), label: "The conclusion", isCorrect: false },
          ],
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "Review the evidence before choosing an intervention.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
  const updated = await page.request.put(`${apiUrl}/v1/presentations/${presentationId}/draft`, {
    data: {
      draft: publishDraft,
      expectedRevision: saved.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(updated.status()).toBe(200);
  const updatedRecord = (await updated.json()).presentation;
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentationId}/publish`,
    {
      data: { expectedDraftRevision: updatedRecord.draftRevision },
    },
  );
  expect(published.status()).toBe(200);
  expect((await published.json()).version.content.blocks[0].textElements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "title",
        text: "Training and recovery",
        region: "bottom_center",
      }),
      expect.objectContaining({
        role: "body",
        text: "Set the context before responding.",
        region: "top_left",
      }),
    ]),
  );
});

test("slide regions reflow into one reading column on narrow screens @mobile", async ({ page }) => {
  await signIn(page);
  const presentationId = await createPresentation(page);
  await page.goto(`/presentation/${presentationId}`);
  await page.getByRole("button", { name: "Hide inspector" }).click();
  await page.getByRole("button", { name: "Collapse map" }).click();
  const slide = page.locator("#presentation-canvas [data-layout]");
  await expect(slide).toBeVisible();
  await expect
    .poll(() =>
      slide
        .locator("[data-region]")
        .first()
        .evaluate((region) => {
          const container = region.parentElement;
          return container
            ? getComputedStyle(container).gridTemplateColumns.trim().split(/\s+/).length
            : 0;
        }),
    )
    .toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
