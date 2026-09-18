import type { ExperienceThemeSnapshot } from "@openround/contracts";

let sharedContext: AudioContext | null = null;

export function unlockSoundCues() {
  sharedContext ??= new window.AudioContext();
  return sharedContext.resume();
}

export function playPresenterCue(
  theme: ExperienceThemeSnapshot | null | undefined,
  eventType: string,
) {
  if (
    !theme?.soundEnabled ||
    theme.soundCue === "none" ||
    document.documentElement.dataset.openroundMuted !== "false"
  ) {
    return;
  }
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = sharedContext ?? new AudioContextClass();
  sharedContext = context;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const lively = theme.soundCue === "celebration";
  oscillator.type = lively ? "triangle" : "sine";
  oscillator.frequency.value =
    eventType === "question.open"
      ? lively
        ? 660
        : 520
      : eventType === "game.finished"
        ? 784
        : 440;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (lively ? 0.22 : 0.14));
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + (lively ? 0.24 : 0.16));
}
