import { describe, expect, it, vi } from "vitest";
import { recoveryPackContentHash } from "@openround/contracts";
import { sourcePackFixtures } from "../test-utils/recovery-pack-source";
import {
  createRecoveryPackSourceApproval,
  createRecoveryPackSourceAuthoring,
  recoveryPackSourceApproved,
  recoveryPackSourceGeneration,
  newRecoveryPackInterventionCard,
  validateRecoveryPackSourceProposal,
} from "./recovery-pack-source";

describe("Recovery Pack source integrity and approval", () => {
  it("adds a source card with original spans that can be reviewed after saving, preserving manual card behavior", async () => {
    const { pack, citation } = sourcePackFixtures();
    const card = newRecoveryPackInterventionCard(pack, "10000000-0000-4000-8000-000000000010");
    expect(card.citations).toEqual([citation]);
    expect(card.citations).not.toBe(pack.draft.citations);
    card.title = "Equal groups";
    card.body = "Divide the whole into two equal groups.";
    const draft = { ...pack.draft, interventions: [...pack.draft.interventions, card] };
    const hash = recoveryPackContentHash(draft);
    const saved = {
      ...pack,
      draft,
      draftRevision: 2,
      sourceReview: { ...pack.sourceReview!, contentHash: hash },
    };
    const approved = {
      ...saved,
      sourceReview: {
        ...saved.sourceReview,
        approved: true,
        approvedContentHash: hash,
        approvedDraftRevision: 2,
        approvedAt: "2026-10-07T12:10:00.000Z",
      },
    };
    const manager = createRecoveryPackSourceApproval({
      pack: saved,
      canApprove: () => true,
      request: vi.fn().mockResolvedValue({ pack: approved }),
    });
    expect(await manager.approve()).toEqual(approved);
    const manual = { ...pack };
    delete manual.sourceReview;
    expect(newRecoveryPackInterventionCard(manual, card.id).citations).toEqual([]);
  });
  it("accepts only the ready job's source, output, complete content and strict visible fields", () => {
    const { proposal, job } = sourcePackFixtures();
    expect(validateRecoveryPackSourceProposal(proposal, job)).toEqual(proposal);
    for (const field of [
      "authoringJobId",
      "sourceName",
      "sourceDigest",
      "sourceOutputHash",
      "contentHash",
    ]) {
      expect(() =>
        validateRecoveryPackSourceProposal(
          {
            ...proposal,
            [field]: field.endsWith("Hash") || field === "sourceDigest" ? "b".repeat(64) : "wrong",
          },
          job,
        ),
      ).toThrow();
    }
    expect(() =>
      validateRecoveryPackSourceProposal(proposal, { ...job, status: "processing" }),
    ).toThrow();
    expect(() =>
      validateRecoveryPackSourceProposal({ ...proposal, unpublishedInstruction: "hidden" }, job),
    ).toThrow();
    const hidden = {
      ...proposal,
      draft: {
        ...proposal.draft,
        diagnostic: { ...proposal.draft.diagnostic, privateAction: "hidden" },
      },
    };
    expect(() => validateRecoveryPackSourceProposal(hidden, job)).toThrow("unknown field");
    const cited = structuredClone(proposal);
    cited.draft.interventions[0]!.citations[0]!.sourceDigest = "b".repeat(64);
    cited.contentHash = recoveryPackContentHash(cited.draft);
    expect(() => validateRecoveryPackSourceProposal(cited, job)).toThrow("citations");
    const invented = structuredClone(proposal);
    invented.draft.interventions[0]!.citations[0]!.excerpt = "Not in the original source output";
    invented.contentHash = recoveryPackContentHash(invented.draft);
    expect(() => validateRecoveryPackSourceProposal(invented, job)).toThrow("citations");
    const outputChanged = structuredClone(job);
    outputChanged.output!.model = "other";
    expect(recoveryPackSourceGeneration(outputChanged)).not.toEqual(
      recoveryPackSourceGeneration(job),
    );
    expect(() => validateRecoveryPackSourceProposal(proposal, outputChanged)).toThrow(
      "does not match",
    );
  });

  it("ties approval to complete saved content and revision while preserving manual Packs", () => {
    const { pack, approvedPack } = sourcePackFixtures();
    expect(recoveryPackSourceApproved(pack)).toBe(false);
    expect(recoveryPackSourceApproved(approvedPack)).toBe(true);
    expect(recoveryPackSourceApproved({ ...approvedPack, draftRevision: 2 })).toBe(false);
    expect(
      recoveryPackSourceApproved({
        ...approvedPack,
        draft: { ...approvedPack.draft, title: "Edited" },
      }),
    ).toBe(false);
    expect(
      recoveryPackSourceApproved({
        ...approvedPack,
        sourceReview: { ...approvedPack.sourceReview!, contentHash: "b".repeat(64) },
      }),
    ).toBe(false);
    const manual = { ...pack };
    delete manual.sourceReview;
    expect(recoveryPackSourceApproved(manual)).toBe(true);
  });

  it("does not create before preview, serializes clicks, and retains the complete creation body after uncertain errors", async () => {
    const { job, proposal, pack } = sourcePackFixtures();
    let resolve!: (result: { pack: typeof pack }) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ proposal })
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValueOnce({ proposal })
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const onCreated = vi.fn();
    const manager = createRecoveryPackSourceAuthoring({
      job,
      canCreate: () => true,
      beforeCreate: () => true,
      request,
      onCreated,
      onState: vi.fn(),
    });
    await manager.create();
    expect(request).not.toHaveBeenCalled();
    await manager.preview();
    await manager.create();
    expect(manager.state().error).toContain("Lost acknowledgement");
    await manager.preview();
    const first = manager.create();
    await manager.create();
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[1]![1].body).toEqual(request.mock.calls[3]![1].body);
    const body = JSON.parse(request.mock.calls[3]![1].body);
    expect(body).toMatchObject({
      draft: proposal.draft,
      sourceOutputHash: proposal.sourceOutputHash,
      expectedContentHash: proposal.contentHash,
      mutationId: expect.any(String),
    });
    resolve({ pack });
    await first;
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(pack);
  });

  it("cancels replaced source/workspace previews and fences late creation acknowledgements", async () => {
    const { job, proposal, pack } = sourcePackFixtures();
    let resolve!: (result: unknown) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onState = vi.fn();
    const onCreated = vi.fn();
    const manager = createRecoveryPackSourceAuthoring({
      job,
      canCreate: () => true,
      beforeCreate: () => true,
      request,
      onCreated,
      onState,
    });
    const preview = manager.preview();
    manager.cancel();
    expect(request.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    const stateCount = onState.mock.calls.length;
    resolve({ proposal });
    await preview;
    expect(onState).toHaveBeenCalledTimes(stateCount);
    expect(manager.state().proposal).toBeNull();
    const nextRequest = vi
      .fn()
      .mockResolvedValueOnce({ proposal })
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const next = createRecoveryPackSourceAuthoring({
      job,
      canCreate: () => true,
      beforeCreate: () => true,
      request: nextRequest,
      onCreated,
      onState: vi.fn(),
    });
    await next.preview();
    const creation = next.create();
    next.cancel();
    resolve({ pack });
    await creation;
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps viewer/paused and dirty-confirmation gates mutation-free", async () => {
    const { job, proposal, pack } = sourcePackFixtures();
    for (const [allowed, confirmed] of [
      [false, true],
      [true, false],
    ]) {
      const request = vi.fn().mockResolvedValue({ proposal });
      const manager = createRecoveryPackSourceAuthoring({
        job,
        canCreate: () => allowed!,
        beforeCreate: () => confirmed!,
        request,
        onCreated: vi.fn(),
        onState: vi.fn(),
      });
      await manager.preview();
      await manager.create();
      expect(request).toHaveBeenCalledTimes(1);
    }
    const request = vi.fn();
    const manager = createRecoveryPackSourceApproval({ pack, canApprove: () => false, request });
    expect(await manager.approve()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("serializes approval and retains its UUID and saved revision after a lost acknowledgement", async () => {
    const { pack, approvedPack } = sourcePackFixtures();
    let resolve!: (result: unknown) => void;
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const manager = createRecoveryPackSourceApproval({ pack, canApprove: () => true, request });
    await expect(manager.approve()).rejects.toThrow("Lost acknowledgement");
    const approval = manager.approve();
    expect(await manager.approve()).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![1].body).toEqual(request.mock.calls[1]![1].body);
    expect(JSON.parse(request.mock.calls[0]![1].body)).toMatchObject({
      expectedDraftRevision: pack.draftRevision,
      expectedContentHash: pack.sourceReview!.contentHash,
      sourceDigest: pack.sourceReview!.sourceDigest,
      sourceOutputHash: pack.sourceReview!.sourceOutputHash,
      approveContent: true,
      approveCitations: true,
    });
    resolve({ pack: approvedPack });
    expect(await approval).toEqual(approvedPack);
  });

  it("fences cancelled/edit-invalidated approval and rejects stale saved hashes/receipt source", async () => {
    const { pack, approvedPack } = sourcePackFixtures();
    expect(() =>
      createRecoveryPackSourceApproval({
        pack: { ...pack, draft: { ...pack.draft, title: "Changed" } },
        canApprove: () => true,
      }),
    ).toThrow("hash has changed");
    let resolve!: (result: unknown) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const manager = createRecoveryPackSourceApproval({ pack, canApprove: () => true, request });
    const approval = manager.approve();
    manager.cancel();
    resolve({ pack: approvedPack });
    expect(await approval).toBeNull();
    const wrong = {
      ...approvedPack,
      sourceReview: { ...approvedPack.sourceReview!, sourceDigest: "b".repeat(64) },
    };
    const next = createRecoveryPackSourceApproval({
      pack,
      canApprove: () => true,
      request: vi.fn().mockResolvedValue({ pack: wrong }),
    });
    await expect(next.approve()).rejects.toThrow("does not match");
  });
});
