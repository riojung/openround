import type { JoinPreflightResponse } from "@openround/contracts";

export interface JoinPreflightState {
  requestId: number;
  code: string;
  status: "idle" | "checking" | "ready" | "failed";
  nicknamePolicy: JoinPreflightResponse["nicknamePolicy"] | null;
  message: string;
}

export const idleJoinPreflightState: JoinPreflightState = {
  requestId: 0,
  code: "",
  status: "idle",
  nicknamePolicy: null,
  message: "",
};

export function beginJoinPreflight(code: string, requestId: number): JoinPreflightState {
  return {
    requestId,
    code,
    status: "checking",
    nicknamePolicy: null,
    message: "",
  };
}

export function completeJoinPreflight(
  current: JoinPreflightState,
  requestId: number,
  response: JoinPreflightResponse,
): JoinPreflightState {
  if (current.requestId !== requestId || current.status !== "checking") return current;
  return {
    ...current,
    status: "ready",
    nicknamePolicy: response.nicknamePolicy,
    message: "",
  };
}

export function failJoinPreflight(
  current: JoinPreflightState,
  requestId: number,
  message: string,
): JoinPreflightState {
  if (current.requestId !== requestId || current.status !== "checking") return current;
  return { ...current, status: "failed", nicknamePolicy: null, message };
}

export function shouldCollectJoinNickname(state: JoinPreflightState, code: string) {
  return !(
    state.code === code &&
    state.status === "ready" &&
    state.nicknamePolicy === "friendly_only"
  );
}

export function nicknameForJoin(
  state: JoinPreflightState,
  code: string,
  nickname: string,
): string | undefined {
  if (!shouldCollectJoinNickname(state, code)) return undefined;
  return nickname.trim() || undefined;
}
