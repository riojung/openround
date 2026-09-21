import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApplyPresentationAuthoringJobSchema,
  AuthoringContentSlideProposalSchema,
  InsertAuthoringProposalsIntoPresentationSchema,
} from "../src/index.js";

describe("source-grounded presentation proposal contracts", () => {
  it("accepts bounded cited content slides and excludes unsupported media layouts", () => {
    const proposal = {
      id: randomUUID(),
      kind: "content",
      layout: "title_body",
      title: "Lockout physically isolates hazardous energy.",
      body: "A warning sign does not provide physical isolation.",
      citations: [
        {
          locator: "paragraph 1",
          excerpt: "Lockout physically isolates hazardous energy.",
        },
      ],
    };
    expect(AuthoringContentSlideProposalSchema.parse(proposal)).toEqual(proposal);
    expect(
      AuthoringContentSlideProposalSchema.safeParse({ ...proposal, layout: "media" }).success,
    ).toBe(false);
    expect(
      AuthoringContentSlideProposalSchema.safeParse({ ...proposal, citations: [] }).success,
    ).toBe(false);
  });

  it("keeps legacy apply payloads valid while requiring a non-empty explicit selection", () => {
    expect(ApplyPresentationAuthoringJobSchema.parse({})).toEqual({});
    expect(
      ApplyPresentationAuthoringJobSchema.safeParse({
        selectedContentSlideIds: [],
        selectedQuestionIds: [],
      }).success,
    ).toBe(false);
    expect(
      ApplyPresentationAuthoringJobSchema.safeParse({
        selectedContentSlideIds: [randomUUID()],
        selectedQuestionIds: [],
      }).success,
    ).toBe(true);
  });

  it("requires insertion fencing, placement, and an idempotent mutation ID", () => {
    const payload = {
      authoringJobId: randomUUID(),
      selectedContentSlideIds: [randomUUID()],
      selectedQuestionIds: [randomUUID()],
      afterBlockId: randomUUID(),
      expectedRevision: 4,
      mutationId: randomUUID(),
    };
    expect(InsertAuthoringProposalsIntoPresentationSchema.parse(payload)).toEqual(payload);
    expect(
      InsertAuthoringProposalsIntoPresentationSchema.safeParse({
        ...payload,
        expectedRevision: -1,
      }).success,
    ).toBe(false);
  });
});
