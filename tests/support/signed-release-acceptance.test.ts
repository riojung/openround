import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  requiredReleaseAssetNames,
  validateAcceptedGithubRelease,
  validateDraftGithubRelease,
  validatePublishedGithubRelease,
  validateReleaseBinding,
  validateReleaseChecksums,
  validateReleasePreflightEvidence,
} from "../../scripts/ops/release-acceptance.mjs";

const tag = "v0.9.0";
const buildId = "a".repeat(40);
const tagObject = "b".repeat(40);
const evidenceCandidateBuildId = "c".repeat(40);

function digest(content: string) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function fixture() {
  const nonChecksumAssets = requiredReleaseAssetNames(tag).filter((name) => name !== "SHA256SUMS");
  const digests = new Map(nonChecksumAssets.map((name) => [name, digest(`content:${name}\n`)]));
  const checksums = `${nonChecksumAssets
    .map((name) => `${digests.get(name)!.slice("sha256:".length)}  ${name}`)
    .join("\n")}\n`;
  const allDigests = new Map([...digests, ["SHA256SUMS", digest(checksums)]]);
  const assets = requiredReleaseAssetNames(tag).map((name, index) => {
    const id = 700_000 + index;
    return {
      id,
      name,
      size:
        name === "SHA256SUMS"
          ? Buffer.byteLength(checksums)
          : Buffer.byteLength(`content:${name}\n`),
      digest: allDigests.get(name)!,
      apiUrl: `https://api.github.com/repos/riojung/openround/releases/assets/${id}`,
      downloadUrl: `https://github.com/riojung/openround/releases/download/${tag}/${name}`,
    };
  });
  const binding = {
    schemaVersion: 2,
    tag,
    tagObject,
    buildId,
    githubRelease: {
      id: 123_456,
      apiUrl: "https://api.github.com/repos/riojung/openround/releases/123456",
      htmlUrl: "https://github.com/riojung/openround/releases/tag/untagged-draft-fixture",
      targetCommitish: buildId,
      draft: true,
      createdAt: "2026-09-26T12:00:00Z",
    },
    manifestDigest: allDigests.get(`openround-${tag}-manifest.json`)!,
    imageDigests: {
      server: `sha256:${"d".repeat(64)}`,
      web: `sha256:${"e".repeat(64)}`,
    },
    assets,
  };
  const release = {
    id: binding.githubRelease.id,
    url: binding.githubRelease.apiUrl,
    html_url: binding.githubRelease.htmlUrl,
    tag_name: tag,
    target_commitish: buildId,
    name: `OpenRound ${tag}`,
    body: "content:release-notes.md\n",
    draft: true,
    prerelease: false,
    created_at: binding.githubRelease.createdAt,
    published_at: null,
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
      url: asset.apiUrl,
      browser_download_url: asset.downloadUrl,
      state: "uploaded",
    })),
  };
  const candidateRun = (workflow: string, path: string, runId: number) => ({
    workflow,
    path,
    runId,
    runNumber: runId,
    runAttempt: 1,
    event: "push",
    headBranch: "main",
    status: "completed",
    conclusion: "success",
    url: `https://github.com/riojung/openround/actions/runs/${runId}`,
    commit: buildId,
    startedAt: "2026-09-26T10:00:00Z",
    completedAt: "2026-09-26T11:00:00Z",
  });
  const preflight = {
    schemaVersion: 1,
    tag,
    commit: buildId,
    tagObject,
    evidenceCandidateCommit: evidenceCandidateBuildId,
    evidenceOnlyDescendant: true,
    onOriginMain: true,
    verification: {
      verified: true,
      reason: "valid",
      verifiedAt: "2026-09-26T09:00:00Z",
    },
    candidateWorkflows: {
      ci: candidateRun("CI", ".github/workflows/ci.yml", 101),
      security: candidateRun("Security", ".github/workflows/security.yml", 102),
      productionSmoke: candidateRun(
        "Production-path-smoke",
        ".github/workflows/production-smoke.yml",
        103,
      ),
    },
  };
  return { assets, binding, checksums, preflight, release };
}

describe("signed release acceptance binding", () => {
  it("binds the exact draft release, required assets, checksums, and main-push provenance", () => {
    const { binding, checksums, preflight, release } = fixture();

    expect(validateReleaseBinding(binding)).toBe(binding);
    expect(validateDraftGithubRelease(release, binding)).toBe(release);
    expect(validateReleaseChecksums(checksums, binding).size).toBe(12);
    expect(validateReleasePreflightEvidence(preflight, binding, evidenceCandidateBuildId)).toBe(
      preflight,
    );
  });

  it("rejects missing, extra, or substituted GitHub release assets", () => {
    const { binding, release } = fixture();
    expect(() => validateReleaseBinding({ ...binding, assets: binding.assets.slice(1) })).toThrow(
      /exact required release asset set/,
    );

    const published = {
      ...release,
      html_url: "https://github.com/riojung/openround/releases/tag/v0.9.0",
      draft: false,
      published_at: "2026-09-26T15:00:00Z",
    };
    expect(() => validateDraftGithubRelease(published, binding)).toThrow(/unpublished draft/);

    const substituted = structuredClone(release);
    substituted.assets[0].digest = `sha256:${"f".repeat(64)}`;
    expect(() => validateDraftGithubRelease(substituted, binding)).toThrow(
      /does not match releaseBinding/,
    );
  });

  it("keeps initial deployment draft-only and validates publication only for recovery", () => {
    const { binding, release } = fixture();
    const acceptedAt = "2026-09-26T14:00:00Z";
    expect(validateAcceptedGithubRelease(release, binding, acceptedAt)).toBe(release);

    const published = {
      ...release,
      html_url: "https://github.com/riojung/openround/releases/tag/v0.9.0",
      draft: false,
      published_at: "2026-09-26T15:00:00Z",
    };
    expect(() => validateAcceptedGithubRelease(published, binding, acceptedAt)).toThrow(
      /unpublished draft/,
    );
    expect(validatePublishedGithubRelease(published, binding, acceptedAt)).toBe(published);
    expect(() =>
      validatePublishedGithubRelease(
        { ...published, published_at: "2026-09-26T13:59:59Z" },
        binding,
        acceptedAt,
      ),
    ).toThrow(/publication predates/);
    expect(() =>
      validatePublishedGithubRelease({ ...published, published_at: null }, binding, acceptedAt),
    ).toThrow(/published/);
  });

  it("accepts only a trusted temporary asset URL while the release is a draft", () => {
    const { binding, release } = fixture();
    const draft = structuredClone(release);
    draft.assets[0].browser_download_url = `https://github.com/riojung/openround/releases/download/untagged-draft-fixture/${draft.assets[0].name}`;
    expect(validateDraftGithubRelease(draft, binding)).toBe(draft);

    draft.assets[0].browser_download_url = `https://attacker.example/riojung/openround/releases/download/untagged-draft-fixture/${draft.assets[0].name}`;
    expect(() => validateDraftGithubRelease(draft, binding)).toThrow(/download URL is not trusted/);
  });

  it("rejects incomplete, non-canonical, or drifted checksum inventories", () => {
    const { binding, checksums } = fixture();
    expect(() => validateReleaseChecksums(checksums.replace(/^[^\n]+\n/, ""), binding)).toThrow(
      /every required release asset/,
    );
    expect(() => validateReleaseChecksums(checksums.replace("  ", " *"), binding)).toThrow(
      /invalid or duplicate entry/,
    );
    expect(() => validateReleaseChecksums(checksums.replace(/[0-9a-f]/, "f"), binding)).toThrow(
      /digest does not match/,
    );
  });

  it("rejects workflow-dispatch, branch, or workflow-path provenance substitutions", () => {
    for (const mutate of [
      (run: Record<string, unknown>) => Object.assign(run, { event: "workflow_dispatch" }),
      (run: Record<string, unknown>) => Object.assign(run, { headBranch: "feature/release" }),
      (run: Record<string, unknown>) =>
        Object.assign(run, { path: ".github/workflows/lookalike.yml" }),
    ]) {
      const { binding, preflight } = fixture();
      mutate(preflight.candidateWorkflows.ci);
      expect(() =>
        validateReleasePreflightEvidence(preflight, binding, evidenceCandidateBuildId),
      ).toThrow(/not a successful main push run/);
    }
  });
});
