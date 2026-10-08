import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import metadata from "../../apps/web/lib/help-video-metadata.json";
import { signInBeta } from "./sign-in";
import { helpFeatureGuides } from "../../apps/web/lib/help-feature-guides";

test("Help videos load on demand and chapters seek without autoplay", async ({ page }) => {
  await signInBeta(page);
  const requestedVideos: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".mp4")) requestedVideos.push(request.url());
  });
  await page.goto("/help");
  await expect(page.locator("video")).toHaveCount(2);
  await expect(page.locator("video").first()).toHaveAttribute("preload", "none");
  await expect(page.locator("video track[kind=captions]")).toHaveCount(2);
  expect(requestedVideos).toEqual([]);
  const quickStart = page.locator("#quick-start");
  const chapter = metadata.quickStart.chapters[1]!;
  await quickStart.getByRole("button", { name: new RegExp(chapter.title) }).click();
  const video = quickStart.locator("video");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
    chapter.start,
    0,
  );
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(chapter.start + 0.1);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.cues?.length ?? 0),
    )
    .toBeGreaterThan(0);
  await expect(quickStart.getByRole("link", { name: "Create your first Round" })).toHaveAttribute(
    "href",
    "/create?start=blank",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("written guides are searchable and link to a paused matching video chapter", async ({
  page,
}, testInfo) => {
  await signInBeta(page);
  await page.goto("/help#feature-guides");
  const catalog = page.locator("#feature-guides");
  await expect(catalog.getByRole("status")).toHaveText(`Guides found: ${helpFeatureGuides.length}`);
  await catalog.getByRole("heading", { name: "Written feature guides" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("guide-catalog.png") });
  await catalog.getByLabel("Search guides").fill("QR phone");
  await catalog.getByLabel("Topic", { exact: true }).selectOption("host");
  await catalog.getByRole("link", { name: "Host a round and share its QR code" }).click();
  await expect(page).toHaveURL(/\/help\/hosting-and-qr$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Host a round and share its QR code",
  );
  await expect(page.locator("#steps")).toContainText(
    "A phone cannot reach the host computer through localhost",
  );
  await expect(page.locator("#success-check")).toContainText("At least two separate devices");
  await page.screenshot({ path: testInfo.outputPath("guide-reading.png") });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("link", { name: "Watch related chapter: Open a lobby and share the QR code" })
    .click();
  await expect(page).toHaveURL(/watch=quick-start&chapter=4#quick-start$/);
  const video = page.locator("#quick-start video");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
    metadata.quickStart.chapters[4]!.start,
    0,
  );
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.goto("/help#feature-guides");
  await page.getByLabel("Search guides").fill("nothing-matches-this-feature");
  await expect(page.getByRole("heading", { name: "No guides match those filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("#feature-guides").getByRole("status")).toHaveText(
    `Guides found: ${helpFeatureGuides.length}`,
  );
  const response = await page.goto("/help/not-a-guide");
  expect(response?.status()).toBe(404);
});

test("classic workspaces can read optional guides without disabled-feature actions", async ({
  page,
}) => {
  await signInBeta(page);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.productFeatures = Object.fromEntries(
      Object.keys(body.productFeatures).map((key) => [key, false]),
    );
    await route.fulfill({ response, json: body });
  });
  await page.goto("/help");
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Written feature guides" })).toBeVisible();
  await page.getByLabel("Search guides").fill("room chat");
  await page
    .locator("#feature-guides")
    .getByRole("link", { name: "Enable and moderate room chat" })
    .click();
  await expect(
    page.getByText("This optional feature is not enabled", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("#steps")).toContainText("Moderate promptly");
  await expect(page.getByRole("link", { name: "Open session history" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Watch related chapter:/ })).toHaveCount(0);
  await page.goto("/help/first-round");
  await expect(
    page.locator("article").getByRole("link", { name: "Open Round dashboard" }),
  ).toHaveAttribute("href", "/dashboard");
});

test("@mobile feature guides remain readable and keyboard accessible on phones", async ({
  page,
}, testInfo) => {
  await signInBeta(page);
  await page.goto("/help#feature-guides");
  const catalog = page.locator("#feature-guides");
  await catalog.getByLabel("Search guides").fill("Pulse");
  await catalog.getByLabel("Topic", { exact: true }).selectOption("interact");
  const link = catalog.getByRole("link", { name: "Read and send Audience Pulse signals" });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/help\/audience-pulse$/);
  await expect(page.locator("#good-to-know")).toContainText("the room sees totals only");
  await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("guide-phone.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "All feature guides", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Written feature guides" })).toBeVisible();
});
