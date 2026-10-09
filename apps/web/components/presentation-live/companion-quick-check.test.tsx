import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "../../lib/i18n/catalog";
import { liveDeliveryEnglishMessages } from "../../lib/i18n/domains/live-delivery";
import type { MessageKey } from "../../lib/i18n/catalog";
import {
  createCompanionQuickCheckDraft,
  type CompanionQuickCheckDraft,
} from "../../lib/presentation-companion-quick-check";
import { CompanionQuickCheckForm } from "./companion-quick-check";
import { CompanionOverlay } from "./companion-overlay";
import { SessionOnlyQuickCheckLabel } from "./session-only-quick-check-label";

const fixtures = vi.hoisted(() => ({ hooks: null as { validation: unknown } | null }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useId: () => (fixtures.hooks ? "quick-check" : react.useId()),
    useState: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      return [
        hooks.validation as T,
        (next: T) => {
          hooks.validation = next;
        },
      ];
    },
  };
});

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(liveDeliveryEnglishMessages, key, values),
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
      candidate.type === "button" &&
      (candidate.props["aria-label"] === name ||
        text(candidate.props.children as ReactNode) === name),
  );
  if (!element) throw new Error(`Expected button: ${name}`);
  return element.props as ComponentProps<"button">;
}

function formHarness(initialDraft = createCompanionQuickCheckDraft()) {
  const hooks = { validation: null as unknown };
  let draft = initialDraft;
  let disabled = false;
  let available = true;
  const onInsert = vi.fn();
  const render = () => {
    fixtures.hooks = hooks;
    try {
      return CompanionQuickCheckForm({
        draft,
        timeMode: "timed",
        disabled,
        available,
        onChange: (next) => {
          draft = next;
        },
        onInsert,
      });
    } finally {
      fixtures.hooks = null;
    }
  };
  return {
    render,
    onInsert,
    draft: () => draft,
    disable: () => {
      disabled = true;
    },
    unavailable: () => {
      available = false;
    },
    change(name: string, value: string) {
      const field = elements(render()).find((element) => element.props.name === name);
      if (!field) throw new Error(`Expected field: ${name}`);
      (field.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
    },
    click(name: string) {
      button(render(), name).onClick?.(
        {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
      );
    },
    submit() {
      const tree = render();
      tree.props.onSubmit?.({ preventDefault: vi.fn() } as unknown as Parameters<
        NonNullable<ComponentProps<"form">["onSubmit"]>
      >[0]);
    },
  };
}

const validDraft: CompanionQuickCheckDraft = {
  prompt: "Which approach should we discuss?",
  choices: ["First approach", "Second approach"],
  timeLimitSeconds: "30",
};

describe("Companion Quick Check form", () => {
  it("labels the modal, prompt, choices, removal actions, and bounded timed-room seconds", () => {
    const markup = renderToStaticMarkup(
      <CompanionOverlay title="Session-only Quick Check" onClose={vi.fn()}>
        <CompanionQuickCheckForm
          draft={createCompanionQuickCheckDraft()}
          timeMode="timed"
          available={true}
          disabled={false}
          onChange={vi.fn()}
          onInsert={vi.fn()}
        />
      </CompanionOverlay>,
    );
    expect(markup).toContain('aria-label="Session-only Quick Check"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Quick Check prompt");
    expect(markup).toContain("Choice 1");
    expect(markup).toContain("Choice 2");
    expect(markup).toContain('aria-label="Remove choice 1"');
    expect(markup).toContain('aria-label="Remove choice 2"');
    expect(markup).toContain('maxLength="500"');
    expect(markup).toContain('maxLength="180"');
    expect(markup).toContain("Response time (seconds)");
    expect(markup).toMatch(/<input[^>]*max="300"[^>]*min="10"[^>]*step="1"[^>]*type="number"/);
    expect(markup).toContain("Insert and start Quick Check");
    expect(markup).not.toContain("confidence");
    expect(markup).not.toContain("correct answer");
  });

  it("explains inherited flex timing with no editable response deadline", () => {
    const markup = renderToStaticMarkup(
      <CompanionQuickCheckForm
        draft={validDraft}
        timeMode="flex"
        available={true}
        disabled={false}
        onChange={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    expect(markup).toContain("There is no response deadline");
    expect(markup).not.toContain('type="number"');
    expect(markup).not.toContain("Response time (seconds)");
  });

  it("names the timed input exactly from its label and keeps timing guidance in its description", () => {
    const tree = formHarness(validDraft).render();
    const seconds = elements(tree).find((element) => element.props.name === "timeLimitSeconds");
    expect(seconds?.props["aria-labelledby"]).toBe("quick-check-seconds-label");
    const label = elements(tree).find(
      (element) => element.props.id === seconds?.props["aria-labelledby"],
    );
    expect(text(label?.props.children as ReactNode)).toBe("Response time (seconds)");
    expect(seconds?.props["aria-describedby"]).toBe("quick-check-timing-help");
  });

  it("preserves controlled fields while adding/removing choices and submits trimmed validated intent", () => {
    const harness = formHarness();
    harness.change("prompt", "  Which approach?  ");
    harness.change("choice-1", "First");
    harness.change("choice-2", "Second");
    harness.change("timeLimitSeconds", "120");
    harness.click("Add choice");
    harness.change("choice-3", "Third");
    harness.click("Remove choice 2");
    expect(harness.draft()).toEqual({
      prompt: "  Which approach?  ",
      choices: ["First", "Third"],
      timeLimitSeconds: "120",
    });
    harness.submit();
    expect(harness.onInsert).toHaveBeenCalledWith({
      prompt: "Which approach?",
      choices: ["First", "Third"],
      timeLimitSeconds: 120,
    });
    expect(harness.draft().prompt).toBe("  Which approach?  ");
  });

  it("announces validation and associates the error with the invalid field without losing other text", () => {
    const harness = formHarness({ ...validDraft, choices: [...validDraft.choices] });
    harness.change("choice-2", " FIRST APPROACH ");
    harness.submit();
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="quick-check-error"');
    expect(markup).toContain("Use different choices");
    expect(harness.onInsert).not.toHaveBeenCalled();
    expect(harness.draft().prompt).toBe(validDraft.prompt);
    harness.change("choice-2", "Second approach");
    expect(renderToStaticMarkup(harness.render())).not.toContain('role="alert"');
    harness.submit();
    expect(harness.onInsert).toHaveBeenCalledOnce();
  });

  it("fences stale form callbacks while disabled or unavailable and preserves the draft", () => {
    const harness = formHarness({ ...validDraft, choices: [...validDraft.choices] });
    const before = harness.draft();
    harness.disable();
    harness.change("prompt", "Changed while pending");
    harness.click("Add choice");
    harness.submit();
    expect(harness.draft()).toBe(before);
    expect(harness.onInsert).not.toHaveBeenCalled();
    const disabledMarkup = renderToStaticMarkup(harness.render());
    expect(disabledMarkup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(disabledMarkup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
    const unavailable = formHarness(validDraft);
    unavailable.unavailable();
    unavailable.submit();
    expect(unavailable.onInsert).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(unavailable.render())).toContain("once per session");
  });

  it("uses the report locale mechanism to label only marked Quick Check evidence as unscored", () => {
    expect(renderToStaticMarkup(<SessionOnlyQuickCheckLabel />)).toBe("");
    const markup = renderToStaticMarkup(<SessionOnlyQuickCheckLabel sessionOnly="quick_check" />);
    expect(markup).toContain("Session-only Quick Check · unscored");
    expect(markup).not.toContain("recovery");
  });
});
