"use client";

import { AVATAR_IDS, type AvatarId } from "@openround/contracts";
import { useLocale } from "./locale-provider";

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
  const { t } = useLocale();
  const avatar = participantAvatarDefinition(avatarId);
  const avatarLabel = avatar ? t(`live.avatar.${avatar.id}`) : t("live.avatar.participant");

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={!decorative ? t("live.avatar.ariaLabel", { name: avatarLabel }) : undefined}
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
      {/* Participant aliases can be written in any language, independently of the UI locale. */}
      <span lang="">{nickname}</span>
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
  const { t } = useLocale();
  return (
    <fieldset aria-describedby="avatar-picker-help" className="avatar-picker" disabled={disabled}>
      <legend>{t("live.avatar.choose")}</legend>
      <p className="muted" id="avatar-picker-help">
        {t("live.avatar.help")}
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
              <span>{t(`live.avatar.${avatar.id}`)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
