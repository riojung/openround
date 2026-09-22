import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  layoutEffects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", () => ({
  useLayoutEffect: (effect: () => void | (() => void)) => {
    hooks.layoutEffects.push(effect);
  },
}));

import { ColorModeSync } from "./color-mode-sync";

describe("ColorModeSync", () => {
  afterEach(() => {
    hooks.layoutEffects.length = 0;
    vi.unstubAllGlobals();
  });

  it("reapplies the initial mode on a Strict Mode remount and cleans up listeners", () => {
    let prefersDark = true;
    const root = {
      dataset: {} as { colorMode?: string; colorModePreference?: string },
      style: { colorScheme: "" },
    };
    const mediaListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const media = {
      get matches() {
        return prefersDark;
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        mediaListeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        if (mediaListeners.get(type) === listener) mediaListeners.delete(type);
      }),
    };
    const fakeWindow = {
      localStorage: { getItem: vi.fn(() => "system") },
      matchMedia: vi.fn(() => media),
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        windowListeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        if (windowListeners.get(type) === listener) windowListeners.delete(type);
      }),
    };

    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("window", fakeWindow);

    expect(ColorModeSync()).toBeNull();
    expect(root.dataset.colorMode).toBeUndefined();

    const firstCleanup = hooks.layoutEffects[0]?.();
    expect(root).toEqual({
      dataset: { colorMode: "dark", colorModePreference: "system" },
      style: { colorScheme: "dark" },
    });
    expect(mediaListeners.has("change")).toBe(true);
    expect(windowListeners.has("storage")).toBe(true);
    expect(windowListeners.has("openround:color-mode-change")).toBe(true);

    expect(firstCleanup).toBeTypeOf("function");
    if (typeof firstCleanup !== "function") throw new Error("Expected an effect cleanup");
    firstCleanup();
    expect(mediaListeners.size).toBe(0);
    expect(windowListeners.size).toBe(0);

    delete root.dataset.colorMode;
    delete root.dataset.colorModePreference;
    root.style.colorScheme = "";

    expect(ColorModeSync()).toBeNull();
    const secondCleanup = hooks.layoutEffects[1]?.();
    expect(root).toEqual({
      dataset: { colorMode: "dark", colorModePreference: "system" },
      style: { colorScheme: "dark" },
    });

    prefersDark = false;
    mediaListeners.get("change")?.(new Event("change"));
    expect(root).toEqual({
      dataset: { colorMode: "light", colorModePreference: "system" },
      style: { colorScheme: "light" },
    });

    expect(secondCleanup).toBeTypeOf("function");
    if (typeof secondCleanup === "function") secondCleanup();
  });
});
