import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { englishMessages, translate, type MessageKey } from "../../lib/i18n/catalog";
import { liveDeliveryEnglishMessages } from "../../lib/i18n/domains/live-delivery";
import type { CompanionPublishedQuestionCatalog } from "../../lib/presentation-companion-published-questions";
import {
  publishedQuestion,
  publishedQuestionCatalog,
} from "../../test-utils/companion-published-questions";
import { CompanionPublishedQuestionPicker } from "./companion-published-questions";
import { CompanionOverlay } from "./companion-overlay";

const fixtures = vi.hoisted(() => ({ hooks: null as { cursor: number; slots: unknown[] } | null }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useId: () => (fixtures.hooks ? "picker" : react.useId()),
    useState: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index] as T,
        (next: T) => {
          hooks.slots[index] = next;
        },
      ];
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate({ ...englishMessages, ...liveDeliveryEnglishMessages }, key, values),
  }),
}));

beforeEach(() => {
  fixtures.hooks = null;
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function button(tree: ReactNode, name: string): ComponentProps<"button"> {
  const element = elements(tree).find(
    (candidate) =>
      candidate.type === "button" && text(candidate.props.children as ReactNode) === name,
  );
  if (!element) throw new Error(`Expected button: ${name}`);
  return element.props as ComponentProps<"button">;
}

function pickerHarness(
  initialCatalog: CompanionPublishedQuestionCatalog = publishedQuestionCatalog,
) {
  const hooks = { cursor: 0, slots: [] as unknown[] };
  let catalog: CompanionPublishedQuestionCatalog | null = initialCatalog;
  let loading = false;
  let disabled = false;
  let error = "";
  const onSearch = vi.fn();
  const onInsert = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    try {
      return CompanionPublishedQuestionPicker({
        catalog,
        loading,
        error,
        disabled,
        onSearch,
        onInsert,
      });
    } finally {
      fixtures.hooks = null;
    }
  };
  return {
    render,
    onSearch,
    onInsert,
    setCatalog: (next: CompanionPublishedQuestionCatalog | null) => {
      catalog = next;
    },
    setLoading: (next: boolean) => {
      loading = next;
    },
    disable: () => {
      disabled = true;
    },
    setError: (next: string) => {
      error = next;
    },
    change(field: "search" | "round" | "question", value: string) {
      const control = elements(render()).find(
        (element) => element.props["aria-labelledby"] === `picker-${field}-label`,
      );
      if (!control) throw new Error(`Expected control: ${field}`);
      (control.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
    },
    click(name: string) {
      button(render(), name).onClick?.(
        {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
      );
    },
    search() {
      const form = elements(render()).find((element) => element.type === "form");
      (form?.props.onSubmit as (event: { preventDefault: () => void }) => void)({
        preventDefault: vi.fn(),
      });
    },
  };
}

describe("Companion safe published question picker", () => {
  it("labels the native modal and requires explicit Round and question selection", () => {
    const markup = renderToStaticMarkup(
      <CompanionOverlay title="Published Round questions" onClose={vi.fn()}>
        <CompanionPublishedQuestionPicker
          catalog={publishedQuestionCatalog}
          loading={false}
          error=""
          disabled={false}
          onSearch={vi.fn()}
          onInsert={vi.fn()}
        />
      </CompanionOverlay>,
    );
    expect(markup).toContain('aria-label="Published Round questions"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Published &lt;Round&gt;");
    expect(markup).toContain("version 2");
    expect(markup).toContain("Choose a published Round");
    expect(markup).toContain("Choose a published question");
    expect(markup).toContain('maxLength="100"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Insert and start question<\/button>/);
  });

  it("shows only title/version/prompt/type and inserts the exact selected source reference", () => {
    const metadata = {
      ...publishedQuestion,
      explanation: "HIDDEN EXPLANATION",
      correctChoiceIds: ["HIDDEN ANSWER KEY"],
      conceptIds: ["HIDDEN CONCEPT"],
      citations: [{ sourceName: "HIDDEN CITATION" }],
    };
    const harness = pickerHarness({ questions: [metadata], hasMore: false });
    harness.change("round", publishedQuestion.sourceQuizVersionId);
    const questionControl = elements(harness.render()).find(
      (element) => element.props["aria-labelledby"] === "picker-question-label",
    );
    expect(questionControl?.props.disabled).toBe(false);
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain(publishedQuestion.prompt);
    expect(markup).toContain("Poll");
    for (const hidden of [
      metadata.explanation,
      metadata.correctChoiceIds[0],
      metadata.conceptIds[0],
      metadata.citations[0]!.sourceName,
    ])
      expect(markup).not.toContain(hidden);
    harness.change("question", publishedQuestion.sourceQuestionId);
    harness.click("Insert and start question");
    expect(harness.onInsert).toHaveBeenCalledWith({
      sourceQuizVersionId: publishedQuestion.sourceQuizVersionId,
      sourceQuestionId: publishedQuestion.sourceQuestionId,
      contentHash: publishedQuestion.contentHash,
    });
  });

  it("searches only on explicit submission and retains the search text for a catalog retry", () => {
    const harness = pickerHarness();
    harness.change("search", "  literal %_ search  ");
    expect(harness.onSearch).not.toHaveBeenCalled();
    harness.search();
    expect(harness.onSearch).toHaveBeenCalledWith("literal %_ search");
    harness.setError("Catalog temporarily unavailable");
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('value="  literal %_ search  "');
    harness.click("Retry loading published questions");
    expect(harness.onSearch.mock.calls).toEqual([["literal %_ search"], ["literal %_ search"]]);
  });

  it("requires a fresh question selection when the Round changes", () => {
    const second = {
      ...publishedQuestion,
      sourceQuizId: "55555555-5555-4555-8555-555555555555",
      sourceQuizVersionId: "66666666-6666-4666-8666-666666666666",
      title: "Another Round",
    };
    const harness = pickerHarness({ questions: [publishedQuestion, second], hasMore: false });
    harness.change("round", publishedQuestion.sourceQuizVersionId);
    harness.change("question", publishedQuestion.sourceQuestionId);
    expect(button(harness.render(), "Insert and start question").disabled).toBe(false);
    harness.change("round", second.sourceQuizVersionId);
    expect(button(harness.render(), "Insert and start question").disabled).toBe(true);
    harness.click("Insert and start question");
    expect(harness.onInsert).not.toHaveBeenCalled();
  });

  it("restores a still-valid selection after loading and disables stale version/hash metadata", () => {
    const harness = pickerHarness();
    harness.change("round", publishedQuestion.sourceQuizVersionId);
    harness.change("question", publishedQuestion.sourceQuestionId);
    harness.setCatalog(null);
    harness.setLoading(true);
    expect(button(harness.render(), "Insert and start question").disabled).toBe(true);
    harness.setLoading(false);
    harness.setCatalog(publishedQuestionCatalog);
    expect(button(harness.render(), "Insert and start question").disabled).toBe(false);
    harness.setCatalog({
      questions: [{ ...publishedQuestion, contentHash: "b".repeat(64) }],
      hasMore: false,
    });
    expect(button(harness.render(), "Insert and start question").disabled).toBe(true);
    harness.click("Insert and start question");
    expect(harness.onInsert).not.toHaveBeenCalled();
    harness.setCatalog({
      questions: [
        { ...publishedQuestion, sourceQuizVersionId: "77777777-7777-4777-8777-777777777777" },
      ],
      hasMore: false,
    });
    expect(button(harness.render(), "Insert and start question").disabled).toBe(true);
  });

  it("discloses bounded search results, empty results, and temporarily unavailable insertion", () => {
    const harness = pickerHarness({ ...publishedQuestionCatalog, hasMore: true });
    expect(renderToStaticMarkup(harness.render())).toContain(
      "Showing up to 100 matching questions",
    );
    harness.setCatalog({ questions: [], hasMore: false });
    expect(renderToStaticMarkup(harness.render())).toContain(
      "No published text-only questions match this search",
    );
    harness.disable();
    expect(renderToStaticMarkup(harness.render())).toContain("eligible pause between blocks");
  });

  it("fences insertion, search, and stale selection callbacks while another command is pending", () => {
    const harness = pickerHarness();
    harness.change("round", publishedQuestion.sourceQuizVersionId);
    harness.change("question", publishedQuestion.sourceQuestionId);
    harness.disable();
    harness.click("Insert and start question");
    harness.change("search", "ignored while pending");
    harness.change("question", "");
    harness.search();
    expect(harness.onInsert).not.toHaveBeenCalled();
    expect(harness.onSearch).not.toHaveBeenCalled();
    expect(
      elements(harness.render()).find(
        (element) => element.props["aria-labelledby"] === "picker-question-label",
      )?.props.value,
    ).toBe(publishedQuestion.sourceQuestionId);
  });
});
