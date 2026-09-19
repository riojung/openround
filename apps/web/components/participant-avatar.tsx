"use client";

import { AVATAR_IDS, type AvatarId } from "@openround/contracts";

export interface ParticipantAvatarDefinition {
  id: AvatarId;
  label: string;
  emoji: string;
  tone: "coral" | "gold" | "indigo" | "mint" | "plum" | "sky" | "teal" | "violet";
}

const avatarDetails: Record<AvatarId, Omit<ParticipantAvatarDefinition, "id">> = {
  comet: { label: "Comet", emoji: "☄️", tone: "violet" },
  fox: { label: "Fox", emoji: "🦊", tone: "coral" },
  owl: { label: "Owl", emoji: "🦉", tone: "gold" },
  otter: { label: "Otter", emoji: "🦦", tone: "teal" },
  panda: { label: "Panda", emoji: "🐼", tone: "mint" },
  robot: { label: "Robot", emoji: "🤖", tone: "sky" },
  rocket: { label: "Rocket", emoji: "🚀", tone: "indigo" },
  star: { label: "Star", emoji: "⭐", tone: "plum" },
};

export const PARTICIPANT_AVATARS: readonly ParticipantAvatarDefinition[] = AVATAR_IDS.map((id) => ({
  id,
  ...avatarDetails[id],
}));

const avatarById = new Map(PARTICIPANT_AVATARS.map((avatar) => [avatar.id, avatar]));

export function participantAvatarDefinition(avatarId?: AvatarId | null) {
  return avatarId ? avatarById.get(avatarId) : undefined;
}

export function ParticipantAvatar({
  avatarId,
  size = "medium",
  decorative = false,
}: {
  avatarId?: AvatarId | null;
  size?: "small" | "medium" | "large";
  decorative?: boolean;
}) {
  const avatar = participantAvatarDefinition(avatarId);

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={!decorative ? `${avatar?.label ?? "Participant"} avatar` : undefined}
      className="participant-avatar"
      data-avatar={avatar?.id ?? "default"}
      data-size={size}
      data-tone={avatar?.tone ?? "sky"}
      role={!decorative ? "img" : undefined}
    >
      <span aria-hidden="true">{avatar?.emoji ?? "●"}</span>
    </span>
  );
}

export function ParticipantIdentity({
  avatarId,
  nickname,
  identityVisible = true,
  size = "small",
}: {
  avatarId?: AvatarId | null;
  nickname: string;
  identityVisible?: boolean;
  size?: "small" | "medium";
}) {
  return (
    <span className="participant-identity">
      <ParticipantAvatar
        avatarId={identityVisible ? avatarId : undefined}
        decorative={!identityVisible}
        size={size}
      />
      <span>{nickname}</span>
    </span>
  );
}

export function AvatarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: AvatarId;
  onChange: (avatarId: AvatarId) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset aria-describedby="avatar-picker-help" className="avatar-picker" disabled={disabled}>
      <legend>Choose your avatar</legend>
      <p className="muted" id="avatar-picker-help">
        Used only for this Round, not as an account profile.
      </p>
      <div className="avatar-picker-grid">
        {PARTICIPANT_AVATARS.map((avatar) => (
          <label
            className="avatar-option"
            data-testid={`avatar-option-${avatar.id}`}
            key={avatar.id}
          >
            <input
              checked={value === avatar.id}
              name="participant-avatar"
              onChange={() => onChange(avatar.id)}
              required
              type="radio"
              value={avatar.id}
            />
            <span className="avatar-option-surface">
              <span aria-hidden="true" className="avatar-option-check">
                ✓
              </span>
              <ParticipantAvatar avatarId={avatar.id} decorative size="medium" />
              <span>{avatar.label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
