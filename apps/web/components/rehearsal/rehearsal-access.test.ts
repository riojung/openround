import { describe, expect, it } from "vitest";
import {
  canAccessRecoveryRehearsal,
  defaultRehearsalContentSource,
  rehearsalReturnLink,
  type RehearsalWorkspaceRole,
} from "./rehearsal-access.js";

describe("recovery rehearsal access", () => {
  it.each<RehearsalWorkspaceRole>(["owner", "editor", "viewer"])(
    "allows the %s role when the workspace product feature is enabled",
    (role) => {
      expect(canAccessRecoveryRehearsal({ role, recoveryRehearsal: true, status: "draft" })).toBe(
        true,
      );
    },
  );

  it.each<RehearsalWorkspaceRole>(["owner", "editor", "viewer"])(
    "blocks the %s role when the workspace product feature is disabled",
    (role) => {
      expect(
        canAccessRecoveryRehearsal({ role, recoveryRehearsal: false, status: "published" }),
      ).toBe(false);
    },
  );

  it.each<RehearsalWorkspaceRole>(["owner", "editor", "viewer"])(
    "blocks archived Rounds for the %s role",
    (role) => {
      expect(
        canAccessRecoveryRehearsal({ role, recoveryRehearsal: true, status: "archived" }),
      ).toBe(false);
    },
  );

  it("uses published evidence for published Rounds and draft evidence otherwise", () => {
    expect(defaultRehearsalContentSource({ status: "published", hasPublishedVersion: true })).toBe(
      "published",
    );
    expect(defaultRehearsalContentSource({ status: "draft", hasPublishedVersion: false })).toBe(
      "draft",
    );
    expect(defaultRehearsalContentSource({ status: "published", hasPublishedVersion: false })).toBe(
      "draft",
    );
  });

  it("rejects archived Rounds before an in-memory rehearsal can start", () => {
    expect(() =>
      defaultRehearsalContentSource({ status: "archived", hasPublishedVersion: true }),
    ).toThrow("Archived Rounds cannot be rehearsed.");
  });

  it("returns viewers to preview and editors to authoring", () => {
    expect(rehearsalReturnLink({ quizId: "quiz-1", role: "viewer", status: "draft" })).toEqual({
      href: "/quiz/quiz-1/preview",
      label: "Back to Round preview",
    });
    expect(rehearsalReturnLink({ quizId: "quiz-1", role: "editor", status: "draft" })).toEqual({
      href: "/quiz/quiz-1",
      label: "Back to editor",
    });
    expect(rehearsalReturnLink({ quizId: "quiz-1", role: "owner", status: "archived" })).toEqual({
      href: "/dashboard",
      label: "Back to Rounds",
    });
  });
});
