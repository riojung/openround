import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import sanitizeHtml from "sanitize-html";

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cleanPlainText(value: string, maxLength: number): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

const blockedNicknameWords = new Set(["admin", "administrator", "moderator", "openround support"]);

const friendlyAdjectives = ["Bright", "Calm", "Curious", "Kind", "Quick", "Sunny"];
const friendlyNouns = ["Badger", "Falcon", "Fox", "Otter", "Panda", "Raven"];

export function normalizeNickname(value: string): string {
  return cleanPlainText(value.normalize("NFKC"), 32);
}

export function nicknameAllowed(value: string): boolean {
  const normalized = normalizeNickname(value).toLocaleLowerCase("en-CA");
  return normalized.length > 0 && !blockedNicknameWords.has(normalized);
}

export function friendlyNickname(seed: number): string {
  const adjective = friendlyAdjectives[seed % friendlyAdjectives.length] ?? "Bright";
  const noun =
    friendlyNouns[Math.floor(seed / friendlyAdjectives.length) % friendlyNouns.length] ?? "Otter";
  return `${adjective} ${noun}`;
}
