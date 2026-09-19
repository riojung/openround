import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVATAR_IDS } from "@openround/contracts";
import {
  AvatarPicker,
  PARTICIPANT_AVATARS,
  ParticipantAvatar,
  ParticipantIdentity,
} from "./participant-avatar";

describe("participant avatars", () => {
  it("defines an original labelled presentation for every contract avatar", () => {
    expect(PARTICIPANT_AVATARS.map((avatar) => avatar.id)).toEqual(AVATAR_IDS);
    expect(new Set(PARTICIPANT_AVATARS.map((avatar) => avatar.emoji)).size).toBe(AVATAR_IDS.length);

    const markup = renderToStaticMarkup(<ParticipantAvatar avatarId="owl" />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Owl avatar"');
    expect(markup).toContain("🦉");
  });

  it("renders a required native radio group with exactly one selected avatar", () => {
    const markup = renderToStaticMarkup(<AvatarPicker onChange={() => undefined} value="rocket" />);
    expect(markup).toContain("Choose your avatar");
    expect(markup.match(/type="radio"/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup.match(/required=""/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup.match(/avatar-option-check/g)).toHaveLength(AVATAR_IDS.length);
    expect(markup).toContain('value="rocket"');
  });

  it("does not expose a chosen avatar when participant identity is masked", () => {
    const markup = renderToStaticMarkup(
      <ParticipantIdentity avatarId="fox" identityVisible={false} nickname="Participant" />,
    );
    expect(markup).toContain("Participant");
    expect(markup).not.toContain("🦊");
    expect(markup).not.toContain("Fox avatar");
    expect(markup).not.toContain('data-avatar="fox"');
  });
});
