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

function isInvisibleControl(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  );
}

export function cleanPlainText(value: string, maxLength: number): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .split("")
    .filter((character) => !isInvisibleControl(character))
    .join("")
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
