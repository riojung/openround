type PassStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function presentationCompanionPassKey(sessionId: string) {
  return `openround:presentation-companion:${sessionId}`;
}

/** Remove the launch secret before any companion network request; reloads use tab storage. */
export function capturePresentationCompanionPass({
  sessionId,
  location,
  history,
  storage,
}: {
  sessionId: string;
  location: Pick<Location, "href">;
  history: Pick<History, "replaceState" | "state">;
  storage: PassStorage;
}) {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasLaunchPass = fragment.has("pass");
  const launchPass = fragment.get("pass");
  if (hasLaunchPass) {
    url.hash = "";
    history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    if (launchPass && launchPass.length >= 32 && launchPass.length <= 1_000) {
      storage.setItem(presentationCompanionPassKey(sessionId), launchPass);
    } else {
      storage.removeItem(presentationCompanionPassKey(sessionId));
    }
  }
  return storage.getItem(presentationCompanionPassKey(sessionId));
}

/** A late rejection must not remove a pass from a newer launch. */
export function rejectPresentationCompanionPass(
  storage: PassStorage,
  sessionId: string,
  rejectedToken: string,
) {
  const key = presentationCompanionPassKey(sessionId);
  if (storage.getItem(key) !== rejectedToken) return false;
  storage.removeItem(key);
  return true;
}

export function presentationCompanionLaunchUrl(origin: string, sessionId: string, pass: string) {
  const url = new URL(`/presentation-session/${encodeURIComponent(sessionId)}/companion`, origin);
  url.hash = new URLSearchParams({ pass }).toString();
  return url.href;
}

/** A newly opened same-origin blank window inherits a tab-storage clone from its opener. */
export function isolatePresentationCompanionWindow<
  Popup extends {
    opener: unknown;
    sessionStorage: Pick<Storage, "clear">;
    close: () => void;
  },
>(popup: Popup | null): Popup | null {
  if (!popup) return null;
  try {
    popup.opener = null;
    // Only the new window's clone is cleared; the host tab's storage remains intact.
    popup.sessionStorage.clear();
    return popup;
  } catch {
    popup.close();
    return null;
  }
}
