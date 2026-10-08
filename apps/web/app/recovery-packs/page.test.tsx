import {
  isValidElement,
  type ComponentProps,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";

interface LibraryHooks {
  cursor: number;
  slots: unknown[];
}

const fixtures = vi.hoisted(() => ({
  enabled: true,
  canEdit: true,
  hooks: null as LibraryHooks | null,
  apiFetch: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (...args: Parameters<typeof react.useEffect>) => {
      if (!fixtures.hooks) react.useEffect(...args);
    },
  };
});

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    creator: { workspaceId: "workspace" },
    productFeatures: { recoveryPacks: fixtures.enabled },
  }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import RecoveryPacksPage from "./page";
import { AuthoringAssistant } from "../../components/authoring-assistant";
import { RecoveryPackSourceReviewPanel } from "../../components/recovery-pack-source";
import type { RecoveryPackRecord } from "../../lib/recovery-pack-source";
import { sourcePackFixtures } from "../../test-utils/recovery-pack-source";

beforeEach(() => {
  fixtures.enabled = true;
  fixtures.canEdit = true;
  fixtures.hooks = null;
  fixtures.apiFetch.mockReset();
});

// Render only the library's state and callbacks here; browser regressions exercise
// the real child controls, event propagation, and effect-driven source fencing.
function libraryHarness(pack: RecoveryPackRecord) {
  const hooks: LibraryHooks = { cursor: 0, slots: [[pack]] };
  const workspace = RecoveryPacksPage().props.children as ReactElement<
    Record<string, never>,
    () => ReactElement<Record<string, never>, () => ReactElement>
  >;
  const library = workspace.type();
  const render = () => {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    try {
      return library.type();
    } finally {
      fixtures.hooks = null;
    }
  };
  button(render(), pack.title).onClick?.(
    {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
  );
  return { render };
}

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

function propsFor<T extends ElementType>(tree: ReactNode, type: T): ComponentProps<T> {
  const element = elements(tree).find((candidate) => candidate.type === type);
  if (!element) throw new Error("Expected library element");
  return element.props as ComponentProps<T>;
}

function button(tree: ReactNode, name: string): ComponentProps<"button"> {
  const element = elements(tree).find(
    (candidate) =>
      candidate.type === "button" && text(candidate.props.children as ReactNode) === name,
  );
  if (!element) {
    const packButton = elements(tree).find(
      (candidate) =>
        candidate.type === "button" && text(candidate.props.children as ReactNode).startsWith(name),
    );
    if (packButton) return packButton.props as ComponentProps<"button">;
    throw new Error(`Expected button: ${name}`);
  }
  return element.props as ComponentProps<"button">;
}

function changeField(tree: ReactNode, name: string, value: string) {
  const label = elements(tree).find(
    (candidate) =>
      candidate.type === "label" &&
      elements(candidate.props.children as ReactNode).some(
        (child) => child.type === "span" && text(child.props.children as ReactNode) === name,
      ),
  );
  const field =
    label &&
    elements(label.props.children as ReactNode).find((candidate) =>
      ["input", "textarea", "select"].includes(String(candidate.type)),
    );
  if (!field) throw new Error(`Expected field: ${name}`);
  (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

describe("Recovery Pack library capability notice", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
  ])("mounts trusted-source creation only when enabled=%s and editable=%s", (enabled, canEdit) => {
    fixtures.enabled = enabled!;
    fixtures.canEdit = canEdit!;
    const markup = renderToStaticMarkup(<RecoveryPacksPage />);
    expect(markup.includes("Draft a Recovery Pack from a trusted source")).toBe(enabled && canEdit);
    expect(markup).toContain("Your Packs");
  });
  it.each([true, false])(
    "keeps insertion, review, and live playback availability accurate with authoring enabled=%s",
    (enabled) => {
      fixtures.enabled = enabled;
      fixtures.canEdit = true;
      const markup = renderToStaticMarkup(<RecoveryPacksPage />);

      expect(markup).toContain(
        "With Pack authoring enabled, insert published Packs into Round or Presentation drafts",
      );
      expect(markup).toContain(
        "review updates against the accepted baseline, local checkpoints, and latest published Pack",
      );
      expect(markup).toContain(
        "References stay frozen until you accept an update; existing published content and sessions are unchanged",
      );
      expect(markup).toContain(
        "Live explanation or worked-example playback is available in eligible new Round or Presentation sessions when enabled for the workspace",
      );
      expect(markup).toContain(
        "The facilitator explicitly selects a card after revealing the Pack diagnostic",
      );
      expect(markup).toContain(
        "Standalone delayed-probe practice is available from a published Pack with a delayed probe",
      );
      expect(markup).toContain(
        "when Pack authoring and practice assignments are enabled and the workspace has Pro follow-ups",
      );
      expect(markup).toContain(
        "Full-sequence practice uses the frozen diagnostic, intervention cards, and linked recheck",
      );
      expect(markup).toContain("without requiring a delayed probe");
      expect(markup).toContain("Delayed recovery trails and Companion insertion are not available");
      expect(markup).not.toContain("not available yet");
      if (!enabled) expect(markup).toContain("Pack authoring is not enabled for this workspace");
    },
  );
});

describe("Recovery Pack review ownership", () => {
  it("keeps selected-Pack checks and saved approval when unrelated source creation controls change", () => {
    const { approvedPack } = sourcePackFixtures();
    const { render } = libraryHarness(approvedPack);
    const review = propsFor(render(), RecoveryPackSourceReviewPanel);
    review.onContentChecked(true);
    review.onCitationsChecked(true);

    const target = propsFor(render(), AuthoringAssistant).recoveryPackTarget!;
    target.onSourceChanged?.();
    changeField(render(), "Source Round", "published-round");
    changeField(render(), "Diagnostic and linked recheck", "diagnostic");

    const currentReview = propsFor(render(), RecoveryPackSourceReviewPanel);
    expect(currentReview.pack).toEqual(approvedPack);
    expect(currentReview.contentChecked).toBe(true);
    expect(currentReview.citationsChecked).toBe(true);
    expect(currentReview.invalidated).toBe(false);
    expect(currentReview.dirty).toBe(false);
    expect(button(render(), "Publish saved draft").disabled).toBe(false);
  });

  it("invalidates selected-Pack approval even if an actual draft edit is reverted", () => {
    const { approvedPack } = sourcePackFixtures();
    const { render } = libraryHarness(approvedPack);
    const review = propsFor(render(), RecoveryPackSourceReviewPanel);
    review.onContentChecked(true);
    review.onCitationsChecked(true);
    const editor = propsFor(render(), "fieldset");
    editor.onChangeCapture?.(
      {} as Parameters<NonNullable<ComponentProps<"fieldset">["onChangeCapture"]>>[0],
    );
    changeField(render(), "Title", "Edited Pack");
    changeField(render(), "Title", approvedPack.title);

    const currentReview = propsFor(render(), RecoveryPackSourceReviewPanel);
    expect(currentReview.dirty).toBe(false);
    expect(currentReview.invalidated).toBe(true);
    expect(currentReview.contentChecked).toBe(false);
    expect(currentReview.citationsChecked).toBe(false);
    expect(button(render(), "Publish saved draft").disabled).toBe(true);
  });

  it("retains an in-flight approval across upload changes and cancels it on a selected-Pack edit", async () => {
    const { pack, approvedPack } = sourcePackFixtures();
    let resolve!: (result: { pack: RecoveryPackRecord }) => void;
    fixtures.apiFetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { render } = libraryHarness(pack);
    const review = propsFor(render(), RecoveryPackSourceReviewPanel);
    review.onContentChecked(true);
    review.onCitationsChecked(true);
    propsFor(render(), RecoveryPackSourceReviewPanel).onApprove();
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    const signal = fixtures.apiFetch.mock.calls[0]![1].signal as AbortSignal;
    propsFor(render(), AuthoringAssistant).recoveryPackTarget!.onSourceChanged?.();
    expect(signal.aborted).toBe(false);
    expect(propsFor(render(), RecoveryPackSourceReviewPanel).contentChecked).toBe(true);

    propsFor(render(), "fieldset").onChangeCapture?.(
      {} as Parameters<NonNullable<ComponentProps<"fieldset">["onChangeCapture"]>>[0],
    );
    changeField(render(), "Title", "Edit during approval");
    expect(signal.aborted).toBe(true);
    resolve({ pack: approvedPack });
    await vi.waitFor(() => {
      expect(propsFor(render(), RecoveryPackSourceReviewPanel).busy).toBe(false);
    });
    const currentReview = propsFor(render(), RecoveryPackSourceReviewPanel);
    expect(currentReview.pack.sourceReview?.approved).toBe(false);
    expect(currentReview.draft.title).toBe("Edit during approval");
    expect(currentReview.contentChecked).toBe(false);
    expect(currentReview.citationsChecked).toBe(false);
    expect(button(render(), "Publish saved draft").disabled).toBe(true);
  });
});
