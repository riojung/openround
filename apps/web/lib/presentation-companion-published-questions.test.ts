import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishedQuestion,
  publishedQuestionCatalog,
} from "../test-utils/companion-published-questions";
import {
  fetchPresentationCompanionPublishedQuestions,
  publishedQuestionSelection,
  selectedPublishedQuestion,
} from "./presentation-companion-published-questions";

afterEach(() => vi.unstubAllGlobals());

describe("Companion published question catalog", () => {
  it("requests scoped safe metadata with literal bounded search and no creator cookies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => publishedQuestionCatalog });
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationCompanionPublishedQuestions(
        "session/fragment",
        "scoped-pass",
        "  Compare 100% _ & examples?  ",
      ),
    ).resolves.toEqual(publishedQuestionCatalog);
    const url = new URL(fetch.mock.calls[0]?.[0], "https://discussion.example.test");
    expect(url.pathname).toBe(
      "/v1/presentation-sessions/session%2Ffragment/companion-published-questions",
    );
    expect(url.searchParams.get("search")).toBe("Compare 100% _ & examples?");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      headers: { authorization: "Bearer scoped-pass" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("omits blank search", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ questions: [], hasMore: false }),
    });
    vi.stubGlobal("fetch", fetch);
    await fetchPresentationCompanionPublishedQuestions("session", "pass", "   ");
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("?");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects an overlong search before making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationCompanionPublishedQuestions("session", "pass", "x".repeat(101)),
    ).rejects.toThrow("100 characters");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["correctChoiceIds", "explanation", "conceptIds", "citations", "choices", "mediaId"])(
    "rejects a catalog that exposes %s",
    async (field) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            questions: [{ ...publishedQuestion, [field]: "HIDDEN SOURCE MATERIAL" }],
            hasMore: false,
          }),
        }),
      );
      await expect(
        fetchPresentationCompanionPublishedQuestions("session", "pass"),
      ).rejects.toThrow();
    },
  );

  it("keeps rejected scoped credentials explicit without trying a creator API", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "UNAUTHORIZED", message: "Pass revoked" } }),
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationCompanionPublishedQuestions("session", "pass"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retains only source identity for insertion and invalidates a missing or changed catalog selection", () => {
    const selection = publishedQuestionSelection(publishedQuestion);
    expect(selection).toEqual({
      sourceQuizVersionId: publishedQuestion.sourceQuizVersionId,
      sourceQuestionId: publishedQuestion.sourceQuestionId,
      contentHash: publishedQuestion.contentHash,
    });
    expect(selectedPublishedQuestion(publishedQuestionCatalog, selection)).toBe(publishedQuestion);
    expect(selectedPublishedQuestion(null, selection)).toBeUndefined();
    expect(selectedPublishedQuestion(publishedQuestionCatalog, null)).toBeUndefined();
    for (const changed of [
      { sourceQuizVersionId: "55555555-5555-4555-8555-555555555555" },
      { sourceQuestionId: "66666666-6666-4666-8666-666666666666" },
      { contentHash: "b".repeat(64) },
    ])
      expect(
        selectedPublishedQuestion(publishedQuestionCatalog, { ...selection, ...changed }),
      ).toBeUndefined();
  });
});
