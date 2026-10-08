import { describe, expect, it, vi } from "vitest";
import {
  capturePresentationCompanionPass,
  isolatePresentationCompanionWindow,
  presentationCompanionLaunchUrl,
  presentationCompanionPassKey,
  rejectPresentationCompanionPass,
} from "./presentation-companion-pass";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

describe("Presentation companion launch pass", () => {
  it("removes the fragment before storing the secret and restores it on reload", () => {
    const pass = "scoped-companion-pass-".repeat(3);
    const tabStorage = storage();
    const order: string[] = [];
    const history = {
      state: { retained: true },
      replaceState: vi.fn(() => {
        order.push("strip");
      }),
    };
    const storageSpy = {
      ...tabStorage,
      setItem: (key: string, value: string) => {
        order.push("store");
        tabStorage.setItem(key, value);
      },
    };
    expect(
      capturePresentationCompanionPass({
        sessionId: "session",
        location: {
          href: `https://example.test/presentation-session/session/companion#pass=${pass}`,
        },
        history,
        storage: storageSpy,
      }),
    ).toBe(pass);
    expect(order).toEqual(["strip", "store"]);
    expect(history.replaceState).toHaveBeenCalledWith(
      { retained: true },
      "",
      "/presentation-session/session/companion",
    );
    expect(tabStorage.getItem(presentationCompanionPassKey("session"))).toBe(pass);
    expect(
      capturePresentationCompanionPass({
        sessionId: "session",
        location: { href: "https://example.test/presentation-session/session/companion" },
        history,
        storage: tabStorage,
      }),
    ).toBe(pass);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
  });

  it("strips malformed passes and clears an earlier pass rather than launching it", () => {
    const key = presentationCompanionPassKey("session");
    const tabStorage = storage({ [key]: "previous-pass" });
    const history = { state: null, replaceState: vi.fn() };
    expect(
      capturePresentationCompanionPass({
        sessionId: "session",
        location: {
          href: "https://example.test/presentation-session/session/companion#pass=short",
        },
        history,
        storage: tabStorage,
      }),
    ).toBeNull();
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/presentation-session/session/companion",
    );
  });

  it("still removes the fragment when tab storage cannot persist the pass", () => {
    const history = { state: null, replaceState: vi.fn() };
    expect(() =>
      capturePresentationCompanionPass({
        sessionId: "session",
        location: {
          href: `https://example.test/presentation-session/session/companion#pass=${"p".repeat(32)}`,
        },
        history,
        storage: {
          ...storage(),
          setItem: () => {
            throw new Error("Storage denied");
          },
        },
      }),
    ).toThrow("Storage denied");
    expect(history.replaceState).toHaveBeenCalledOnce();
  });

  it("rejects only the current pass and scopes storage by session", () => {
    const tabStorage = storage({
      [presentationCompanionPassKey("session")]: "new-pass",
      [presentationCompanionPassKey("other")]: "other-pass",
    });
    expect(rejectPresentationCompanionPass(tabStorage, "session", "old-pass")).toBe(false);
    expect(tabStorage.getItem(presentationCompanionPassKey("session"))).toBe("new-pass");
    expect(rejectPresentationCompanionPass(tabStorage, "session", "new-pass")).toBe(true);
    expect(tabStorage.getItem(presentationCompanionPassKey("session"))).toBeNull();
    expect(tabStorage.getItem(presentationCompanionPassKey("other"))).toBe("other-pass");
  });

  it("puts launch secrets exclusively in the fragment", () => {
    const url = new URL(
      presentationCompanionLaunchUrl("https://example.test", "session", "p".repeat(32)),
    );
    expect(url.pathname).toBe("/presentation-session/session/companion");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("pass")).toBe("p".repeat(32));
  });

  it("removes inherited host credentials from the new popup without touching its parent", () => {
    const parentStorage = storage({
      "openround:presentation-host:session": "host-pass",
      "other-host-key": "another-host-pass",
    });
    const popupStorage = storage({
      "openround:presentation-host:session": "host-pass",
      "other-host-key": "another-host-pass",
    });
    const popup = { opener: {}, sessionStorage: popupStorage, close: vi.fn() };
    expect(isolatePresentationCompanionWindow(popup)).toBe(popup);
    expect(popup.opener).toBeNull();
    expect(popupStorage.getItem("openround:presentation-host:session")).toBeNull();
    expect(popupStorage.getItem("other-host-key")).toBeNull();
    expect(parentStorage.getItem("openround:presentation-host:session")).toBe("host-pass");
    expect(parentStorage.getItem("other-host-key")).toBe("another-host-pass");
  });

  it("closes an unisolated popup and handles a blocked popup", () => {
    const popup = {
      opener: {},
      sessionStorage: {
        clear: () => {
          throw new Error("Denied");
        },
      },
      close: vi.fn(),
    };
    expect(isolatePresentationCompanionWindow(popup)).toBeNull();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(isolatePresentationCompanionWindow(null)).toBeNull();
  });
});
