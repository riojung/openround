import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AVATAR_IDS } from "@openround/contracts";
import { withEnglishLocale } from "../test-utils/english-locale";
import {
  AvatarPicker,
  PARTICIPANT_AVATARS,
  ParticipantAvatar,
  ParticipantIdentity,
} from "./participant-avatar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/play/test-session",
}));

describe("participant avatars", () => {
  it("defines an original labelled presentation for every contract avatar", () => {
    expect(PARTICIPANT_AVATARS.map((avatar) => avatar.id)).toEqual(AVATAR_IDS);
    expect(new Set(PARTICIPANT_AVATARS.map((avatar) => avatar.emoji)).size).toBe(AVATAR_IDS.length);

    const markup = renderToStaticMarkup(withEnglishLocale(<ParticipantAvatar avatarId="owl" />));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Owl avatar"');
    expect(markup).toContain("🦉");
  });

  it("renders a required native radio group with exactly one selected avatar", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<AvatarPicker onChange={() => undefined} value="rocket" />),
    );
    expect(markup).toContain("Choose your avatar");
    expect(markup.match(/type="radio"/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup.match(/required=""/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup.match(/avatar-option-check/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup).toContain('value="rocket"');
  });

  it("masks the chosen avatar and leaves the participant-authored nickname language unknown", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ParticipantIdentity avatarId="fox" identityVisible={false} nickname="Participant" />,
      ),
    );
    expect(markup).toContain("Participant");
    expect(markup).toContain('<span lang="">Participant</span>');
    expect(markup).not.toContain("🦊");
    expect(markup).not.toContain("Fox avatar");
    expect(markup).not.toContain('data-avatar="fox"');
  });
});
