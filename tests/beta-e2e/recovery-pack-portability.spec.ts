import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import type { RecoveryPackContent, RecoveryPackExportReport } from "@openround/contracts";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Read the bounded fixture package through its central directory, including ZIP data descriptors.
function qtiFiles(archive: Buffer) {
  const end = archive.lastIndexOf(Buffer.from("504b0506", "hex"));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = archive.readUInt16LE(end + 10);
  expect(count).toBeLessThanOrEqual(8);
  let offset = archive.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    expect(size).toBeLessThanOrEqual(1_000_000);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    expect(archive.readUInt32LE(localOffset)).toBe(0x04034b50);
    const bodyOffset =
      localOffset +
      30 +
      archive.readUInt16LE(localOffset + 26) +
      archive.readUInt16LE(localOffset + 28);
    const compressed = archive.subarray(bodyOffset, bodyOffset + compressedSize);
    expect([0, 8]).toContain(method);
    const body =
      method === 8 ? inflateRawSync(compressed, { maxOutputLength: 1_000_000 }) : compressed;
    expect(body.length).toBe(size);
    files.set(name, body.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function portabilityWorkflow(page: Page) {
  test.setTimeout(120_000);
  await signInBeta(page);
  const title = `Portable recovery ${randomUUID().slice(0, 8)}`;
  // Beta has no object store/scanner. Registered-media omission is covered by server tests;
  // this real API browser fixture deliberately has no invented media references.
  const cardBody = `Private facilitator-only contrast ${randomUUID()}`;
  const citation = {
    sourceName: `Private handbook ${randomUUID()}`,
    sourceDigest: "a".repeat(64),
    locator: "p. 4",
    excerpt: "https://private.example/" + "UnbrokenCitation".repeat(25),
  };
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "numeric",
    prompt,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["evidence"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Frozen checkpoint explanation: divide into two equal groups.",
    mediaId: null as string | null,
    mediaAlt: null as string | null,
    correctValue: "4",
    tolerance: "0",
    unit: null,
  });
  const recheck = {
    ...question("Frozen immediate recheck: what is half of twelve?"),
    correctValue: "6",
    delivery: "recheck",
  };
  const created = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: {
      draft: {
        schemaVersion: 1,
        title,
        description: "Frozen Pack description",
        diagnostic: {
          ...question("Frozen diagnostic: what is half of eight?"),
          linkedRecheckQuestionId: recheck.id,
          sourceCitations: [citation],
        },
        recheck,
        delayedProbe: question("Frozen delayed probe: transfer the same concept later."),
        interventions: [
          {
            id: randomUUID(),
            title: "Frozen facilitator contrast",
            body: cardBody,
            citations: [citation],
          },
        ],
        conceptKeys: ["evidence"],
        misconceptionKeys: [],
        citations: [citation],
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const pack = (await created.json()).pack;
  const published = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: 0 },
  });
  expect(published.status(), await published.text()).toBe(200);
  const version = (await published.json()).version;
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/media")) mediaRequests.push(request.url());
  });
  await page.goto("/recovery-packs");
  await page.getByRole("button").filter({ hasText: title }).click();
  const panel = page.getByRole("region", { name: "Checkpoint portability", exact: true });
  await expect(panel).toBeVisible();
  const activate = async (name: string) => {
    const control = panel.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    await control.focus();
    await expect(control).toBeFocused();
    await control.press("Enter");
  };
  await expect(
    panel.getByRole("button", { name: "Download CSV checkpoints", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "Download export report JSON", exact: true }),
  ).toBeDisabled();
  const fillText = async (name: string, value: string) => {
    const control = page.getByRole("textbox", { name, exact: true });
    await expect(control).toBeVisible({ timeout: 5_000 });
    await expect(control).toBeEnabled({ timeout: 5_000 });
    await control.fill(value);
  };
  await fillText("Title", "Unsaved title must not become the exported source");
  await fillText("Diagnostic prompt", "Unsaved diagnostic must not be exported");
  await fillText("Card 1 facilitator guidance", "Unsaved facilitator guidance");

  const csvStarted = deferred();
  const releaseCsv = deferred();
  const csvHandled = deferred();
  let holdCsv = true;
  let qtiReport: unknown;
  await page.route(
    `**/v1/recovery-packs/versions/${version.id}/export-report?format=*`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const { report } = await response.json();
      if (new URL(route.request().url()).searchParams.get("format") === "qti3") qtiReport = report;
      if (holdCsv && report.format === "csv") {
        holdCsv = false;
        csvStarted.resolve();
        await releaseCsv.promise;
        try {
          await route.fulfill({ response });
        } catch {
          /* The cancelled preview may already be detached. */
        } finally {
          csvHandled.resolve();
        }
      } else await route.fulfill({ response });
    },
  );
  const artifactStarted = deferred();
  const releaseArtifact = deferred();
  let failArtifact = true;
  await page.route(`**/v1/recovery-packs/versions/${version.id}/export.qti.zip`, async (route) => {
    if (failArtifact) {
      failArtifact = false;
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Export temporarily unavailable. Retry this reviewed package.",
          },
        },
      });
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    expect(response.headers()["x-openround-export-report"]).toBe(
      `/v1/recovery-packs/versions/${version.id}/export-report?format=qti3`,
    );
    artifactStarted.resolve();
    await releaseArtifact.promise;
    await route.fulfill({ response });
  });

  try {
    await activate("Review export losses");
    await csvStarted.promise;
    await panel.getByLabel("Published Pack export format").selectOption("qti3");
    await expect(
      panel.getByRole("button", { name: "Download QTI 3 package", exact: true }),
    ).toBeDisabled();
    await activate("Review export losses");
    await expect(
      panel.getByRole("heading", { name: "Reviewed QTI 3 export", exact: true }),
    ).toBeFocused();
    releaseCsv.resolve();
    await csvHandled.promise;
    await expect(
      panel.getByRole("heading", { name: "Reviewed CSV export", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("heading", { name: "Reviewed QTI 3 export", exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText(version.contentHash);
    await expect(panel).toContainText("3 of 3 checkpoints exportable");
    await expect(panel).toContainText("PACK_SEQUENCE_OMITTED");
    await expect(panel).toContainText("PACK_INTERVENTIONS_OMITTED");
    await expect(panel).toContainText("CHECKPOINT_CITATIONS_OMITTED");
    await expect(panel).toContainText("INTERVENTION_CITATIONS_OMITTED");
    await expect(panel).toContainText("QTI_OPENROUND_METADATA");
    await expect(panel).toContainText(title);
    await expect(panel).not.toContainText("Unsaved");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);

    const reportDownload = page.waitForEvent("download");
    await activate("Download export report JSON");
    const savedReport = await reportDownload;
    expect(savedReport.suggestedFilename()).toBe(
      `polling-pops-recovery-pack-${version.id}-qti3-export-report.json`,
    );
    const report = JSON.parse(
      (await downloadBytes(savedReport)).toString("utf8"),
    ) as RecoveryPackExportReport;
    expect(report).toMatchObject({
      schemaVersion: 1,
      format: "qti3",
      checkpointCount: 3,
      exportedCheckpointCount: 3,
      canExport: true,
      findings: expect.any(Array),
    });
    expect(report).toEqual(qtiReport);
    expect(report.source).toEqual({
      artifactType: "recovery_pack",
      packId: pack.id,
      packVersionId: version.id,
      packVersion: 1,
      contentHash: version.contentHash,
      title,
    });

    const downloads: Download[] = [];
    page.on("download", (download) => downloads.push(download));
    await activate("Download QTI 3 package");
    await expect(panel.getByRole("alert")).toContainText("Export temporarily unavailable");
    await expect(
      panel.getByRole("button", { name: "Download QTI 3 package", exact: true }),
    ).toBeEnabled();
    expect(downloads).toHaveLength(0);
    const qtiDownload = page.waitForEvent("download");
    await activate("Download QTI 3 package");
    await artifactStarted.promise;
    await expect(panel.getByLabel("Published Pack export format")).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Review export losses", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Download export report JSON", exact: true }),
    ).toBeDisabled();
    releaseArtifact.resolve();
    const savedQti = await qtiDownload;
    expect(savedQti.suggestedFilename()).toBe(`polling-pops-recovery-pack-${version.id}.qti.zip`);
    const files = qtiFiles(await downloadBytes(savedQti));
    expect(files.size).toBe(5);
    expect(files.has("imsmanifest.xml")).toBe(true);
    expect(JSON.parse(files.get("openround-export-report.json")!)).toEqual(report);
    const items = [...files].filter(([name]) => name.startsWith("items/") && name.endsWith(".xml"));
    expect(items).toHaveLength(3);
    const decoded = items.map(([, xml]) => {
      const metadata = xml.match(
        /identifier="OPENROUND_METADATA"[\s\S]*?<qti-value>([^<]+)<\/qti-value>/,
      );
      expect(metadata).not.toBeNull();
      return JSON.parse(Buffer.from(metadata![1]!, "base64url").toString("utf8"));
    });
    const projection = [...files.values()].join("\n") + JSON.stringify(decoded);
    for (const forbidden of [
      citation.sourceName,
      citation.excerpt,
      cardBody,
      "Unsaved",
      "downloadUrl",
      "mediaId",
      "mediaAlt",
      "accessSeed",
      "#token=",
    ])
      expect(projection).not.toContain(forbidden);
    expect(files.get("imsmanifest.xml")).not.toContain("assets/");
    expect(decoded.map((item) => item.sourceId)).toEqual([
      version.content.diagnostic.id,
      version.content.recheck.id,
      version.content.delayedProbe.id,
    ]);
    expect(items.map(([, xml]) => xml).join("\n")).toContain(
      "Frozen diagnostic: what is half of eight?",
    );

    await expect(panel.getByLabel("Published Pack export format")).toBeEnabled();
    await panel.getByLabel("Published Pack export format").selectOption("csv");
    await expect(
      panel.getByRole("button", { name: "Download CSV checkpoints", exact: true }),
    ).toBeDisabled();
    await activate("Review export losses");
    await expect(
      panel.getByRole("heading", { name: "Reviewed CSV export", exact: true }),
    ).toBeFocused();
    const csvDownload = page.waitForEvent("download");
    await activate("Download CSV checkpoints");
    const savedCsv = await csvDownload;
    expect(savedCsv.suggestedFilename()).toBe(`polling-pops-recovery-pack-${version.id}.csv`);
    const csv = (await downloadBytes(savedCsv)).toString("utf8");
    expect(csv).toContain(version.content.diagnostic.id);
    expect(csv).toContain("Frozen diagnostic: what is half of eight?");
    expect(csv).toContain("Frozen immediate recheck: what is half of twelve?");
    expect(csv).toContain("Frozen delayed probe: transfer the same concept later.");
    expect(csv.trim().split("\r\n")).toHaveLength(4);
    for (const omitted of [citation.sourceName, citation.excerpt, cardBody, "Unsaved"])
      expect(csv).not.toContain(omitted);

    const nativeDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Polling Pops JSON", exact: true }).click();
    const savedNative = await nativeDownload;
    expect(savedNative.suggestedFilename()).toBe(`${title.replace(/[^a-zA-Z0-9_-]+/g, "-")}.json`);
    const native = JSON.parse((await downloadBytes(savedNative)).toString("utf8")) as {
      format: "openround-recovery-pack";
      schemaVersion: 1;
      content: RecoveryPackContent;
    };
    expect(native).toMatchObject({ format: "openround-recovery-pack", schemaVersion: 1 });
    expect(native.content).toEqual(version.content);
    expect(native.content.diagnostic.mediaId).toBeNull();
    expect(native.content.diagnostic.mediaAlt).toBeNull();
    expect(native.content.diagnostic.sourceCitations).toEqual([citation]);
    expect(native.content.citations).toEqual([citation]);
    expect(native.content.interventions[0]!.body).toBe(cardBody);
    expect(mediaRequests).toHaveLength(0);

    // Simulate read-only/paused authoring UI while retaining real creator-auth export reads.
    await page.route("**/v1/auth/me", async (route) => {
      const response = await route.fetch();
      const account = await response.json();
      await route.fulfill({
        response,
        json: {
          ...account,
          creator: { ...account.creator, role: "viewer" },
          productFeatures: { ...account.productFeatures, recoveryPacks: false },
        },
      });
    });
    let sourcePaused = true;
    await page.route(`${apiUrl}/v1/recovery-packs/versions/${version.id}`, async (route) => {
      if (sourcePaused)
        await route.fulfill({
          status: 503,
          json: {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Published source temporarily unavailable.",
            },
          },
        });
      else await route.continue();
    });
    await page.goto("/recovery-packs");
    await page.getByRole("button").filter({ hasText: title }).click();
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
    const sourceRetry = page.getByRole("button", {
      name: "Retry published export source",
      exact: true,
    });
    await expect(sourceRetry).toBeEnabled();
    sourcePaused = false;
    await sourceRetry.focus();
    await expect(sourceRetry).toBeFocused();
    await sourceRetry.press("Enter");
    await expect(panel).toBeVisible();
    await activate("Review export losses");
    await expect(
      panel.getByRole("button", { name: "Download CSV checkpoints", exact: true }),
    ).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    releaseCsv.resolve();
    releaseArtifact.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
}

test("Published Pack CSV/QTI export reviews losses, preserves frozen source, retries downloads and fences stale formats", async ({
  page,
}) => {
  await portabilityWorkflow(page);
});
test("Published Pack portability keeps keyboard and automated accessibility usable with authoring paused @mobile", async ({
  page,
}) => {
  await portabilityWorkflow(page);
});
