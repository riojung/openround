"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ExperiencePresetIdSchema,
  SessionSettingsSchema,
  type Entitlements,
  type ExperiencePresetId,
  type QuizDraft,
  type SessionSettings,
  type SessionSnapshot,
} from "@openround/contracts";
import { Brand } from "../../../../components/brand";
import { ExperiencePicker } from "../../../../components/experience-picker";
import { apiFetch, humanError } from "../../../../lib/api";
import {
  resolveSetupRecipe,
  setupRecipeStorageKey,
  type SetupRecipe,
} from "../../../../lib/setup-recipes";

interface Creator {
  workspaceId: string;
  segment: "education" | "workplace";
}

interface QuizRecord {
  id: string;
  title: string;
  draft: QuizDraft;
  currentVersionId: string | null;
}

interface QuizVersionRecord {
  content: QuizDraft;
}

interface ProductFeatures {
  roundExperiences: boolean;
  audiencePulse: boolean;
  roomChat: boolean;
  uxBeta: boolean;
}

function defaultsFor(creator: Creator, entitlements: Entitlements): SessionSettings {
  return {
    audienceLimit: Math.min(
      creator.segment === "education" ? 20 : 100,
      entitlements.maxParticipants,
    ),
    scoringMode: creator.segment === "education" ? "accuracy" : "speed",
    resultVisibility: creator.segment === "education" ? "private" : "leaderboard",
    allowLateJoin: true,
    nicknamePolicy: creator.segment === "education" ? "friendly_only" : "custom",
  };
}

function SetupReview({ uxBeta, children }: { uxBeta: boolean; children: ReactNode }) {
  if (!uxBeta) return <>{children}</>;
  return (
    <details className="panel setup-review">
      <summary>Review settings</summary>
      <p className="muted">
        The recipe is ready to use. Open this section only when you need an override.
      </p>
      {children}
    </details>
  );
}

export default function HostSetupPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [publishedContent, setPublishedContent] = useState<QuizDraft | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [settings, setSettings] = useState<SessionSettings | null>(null);
  const [experiencePreset, setExperiencePreset] = useState<ExperiencePresetId>("focus");
  const [presenterSoundEnabled, setPresenterSoundEnabled] = useState(false);
  const [roundExperiencesAvailable, setRoundExperiencesAvailable] = useState(false);
  const [uxBeta, setUxBeta] = useState(false);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [recipe, setRecipe] = useState<SetupRecipe | "custom">("recovery");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch<{ quiz: QuizRecord; currentVersion: QuizVersionRecord | null }>(
        `/v1/quizzes/${quizId}`,
      ),
      apiFetch<{
        creator: Creator;
        entitlements: Entitlements;
        productFeatures: ProductFeatures;
      }>("/v1/auth/me"),
    ])
      .then(([quizResponse, account]) => {
        if (!quizResponse.quiz.currentVersionId || !quizResponse.currentVersion) {
          setError(
            account.productFeatures.uxBeta
              ? "Publish this Round before creating a live session."
              : "Publish this checkpoint set before creating a live round.",
          );
          return;
        }
        setQuiz(quizResponse.quiz);
        setPublishedContent(quizResponse.currentVersion.content);
        setEntitlements(account.entitlements);
        setCreator(account.creator);
        setRoundExperiencesAvailable(account.productFeatures.roundExperiences);
        setUxBeta(account.productFeatures.uxBeta);
        const defaults = defaultsFor(account.creator, account.entitlements);
        if (!account.productFeatures.uxBeta) {
          setSettings(defaults);
          setExperiencePreset(
            account.productFeatures.roundExperiences
              ? (quizResponse.currentVersion.content.experiencePreset?.id ?? "focus")
              : "focus",
          );
          setPresenterSoundEnabled(false);
          return;
        }
        let restored = false;
        try {
          const saved = JSON.parse(
            localStorage.getItem(setupRecipeStorageKey(account.creator.workspaceId)) ?? "null",
          ) as {
            recipe?: SetupRecipe | "custom";
            settings?: SessionSettings;
            experiencePreset?: ExperiencePresetId;
            presenterSoundEnabled?: boolean;
          } | null;
          const parsedSettings = SessionSettingsSchema.safeParse(saved?.settings);
          const parsedPreset = ExperiencePresetIdSchema.safeParse(saved?.experiencePreset);
          const parsedRecipe = ["recovery", "competition", "discussion", "custom"].includes(
            saved?.recipe ?? "",
          )
            ? saved!.recipe!
            : "custom";
          if (parsedSettings.success) {
            setSettings({
              ...parsedSettings.data,
              audienceLimit: Math.min(
                Math.max(1, parsedSettings.data.audienceLimit),
                account.entitlements.maxParticipants,
              ),
            });
            setRecipe(parsedRecipe);
            setExperiencePreset(
              account.productFeatures.roundExperiences
                ? parsedPreset.success
                  ? parsedPreset.data
                  : "focus"
                : "focus",
            );
            setPresenterSoundEnabled(
              account.productFeatures.roundExperiences && Boolean(saved?.presenterSoundEnabled),
            );
            restored = true;
          }
        } catch {
          localStorage.removeItem(setupRecipeStorageKey(account.creator.workspaceId));
        }
        if (!restored) {
          const resolved = resolveSetupRecipe("recovery", defaults, {
            segment: account.creator.segment,
            maxParticipants: account.entitlements.maxParticipants,
            roundExperiencesAvailable: account.productFeatures.roundExperiences,
          });
          setSettings(resolved.settings);
          setExperiencePreset(resolved.experiencePreset);
          setPresenterSoundEnabled(resolved.presenterSoundEnabled);
        }
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [quizId, router]);

  useEffect(() => {
    if (!creator || !settings || !uxBeta) return;
    localStorage.setItem(
      setupRecipeStorageKey(creator.workspaceId),
      JSON.stringify({ recipe, settings, experiencePreset, presenterSoundEnabled }),
    );
  }, [creator, experiencePreset, presenterSoundEnabled, recipe, settings, uxBeta]);

  function applyRecipe(nextRecipe: SetupRecipe) {
    if (!settings || !creator || !entitlements) return;
    const resolved = resolveSetupRecipe(nextRecipe, settings, {
      segment: creator.segment,
      maxParticipants: entitlements.maxParticipants,
      roundExperiencesAvailable,
    });
    setRecipe(nextRecipe);
    setSettings(resolved.settings);
    setExperiencePreset(resolved.experiencePreset);
    setPresenterSoundEnabled(resolved.presenterSoundEnabled);
    void apiFetch<{ accepted: number }>("/v1/product-events", {
      method: "POST",
      body: JSON.stringify({
        events: [
          {
            name: "setup_recipe_selected",
            occurredAt: new Date().toISOString(),
            dimensions: {
              recipe:
                nextRecipe === "competition"
                  ? "friendly_competition"
                  : nextRecipe === "discussion"
                    ? "open_discussion"
                    : "recovery",
            },
          },
        ],
      }),
    }).catch(() => undefined);
  }

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!quiz || !publishedContent || !settings || !entitlements || busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await apiFetch<{
        sessionId: string;
        code: string;
        hostToken: string;
        snapshot: SessionSnapshot;
      }>("/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          quizId: quiz.id,
          settings,
          ...(roundExperiencesAvailable &&
          experiencePreset !== (publishedContent.experiencePreset?.id ?? "focus")
            ? { experiencePresetOverride: experiencePreset }
            : {}),
          presenterSoundEnabled: roundExperiencesAvailable && presenterSoundEnabled,
        }),
      });
      sessionStorage.setItem(`openround:host:${session.sessionId}`, session.hostToken);
      sessionStorage.setItem(`openround:code:${session.sessionId}`, session.code);
      router.push(`/host/${session.sessionId}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="shell topbar" data-ux-beta={uxBeta || undefined}>
        <Brand />
        <div className="button-row">
          {quiz ? (
            <Link className="button-quiet small-button" href={`/quiz/${quiz.id}/preview`}>
              {uxBeta ? "Preview Round" : "Preview checkpoint set"}
            </Link>
          ) : null}
          <Link className="button-quiet small-button" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Live session setup</p>
            <h1>{quiz?.title ?? "Prepare the room"}</h1>
            <p className="muted">Review the defaults before creating the room code.</p>
          </div>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!settings || !entitlements ? (
          !error ? (
            <p>Loading session settings…</p>
          ) : null
        ) : (
          <form onSubmit={createSession}>
            {uxBeta ? (
              <section className="panel setup-recipes" data-testid="session-setup">
                <p className="eyebrow">Start with a recipe</p>
                <h2 style={{ fontSize: "1.8rem" }}>Choose the facilitation style</h2>
                <div className="recipe-grid">
                  <button
                    aria-pressed={recipe === "recovery"}
                    className="recipe-card"
                    data-recipe="recovery"
                    onClick={() => applyRecipe("recovery")}
                    type="button"
                  >
                    <strong>Recovery</strong>
                    <span>Private, accuracy-first, with calm visual defaults.</span>
                  </button>
                  <button
                    aria-pressed={recipe === "competition"}
                    className="recipe-card"
                    data-recipe="competition"
                    onClick={() => applyRecipe("competition")}
                    type="button"
                  >
                    <strong>Friendly competition</strong>
                    <span>Speed scoring and visible standings; sound stays optional.</span>
                  </button>
                  <button
                    aria-pressed={recipe === "discussion"}
                    className="recipe-card"
                    data-recipe="discussion"
                    onClick={() => applyRecipe("discussion")}
                    type="button"
                  >
                    <strong>Open discussion</strong>
                    <span>
                      Private results with Pulse and Q&amp;A available; chat starts closed.
                    </span>
                  </button>
                </div>
              </section>
            ) : null}
            <SetupReview uxBeta={uxBeta}>
              <div className="settings-grid">
                <section className="panel">
                  <p className="eyebrow">Room</p>
                  <h2 style={{ fontSize: "1.8rem" }}>Audience and joining</h2>
                  <label className="field" htmlFor="audience-limit">
                    <span>Maximum participants</span>
                    <input
                      className="input"
                      id="audience-limit"
                      max={entitlements.maxParticipants}
                      min={1}
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({ ...settings, audienceLimit: Number(event.target.value) });
                      }}
                      required
                      type="number"
                      value={settings.audienceLimit}
                    />
                    <small className="muted">
                      Your current plan supports up to {entitlements.maxParticipants}.
                    </small>
                  </label>
                  <label className="checkbox-field">
                    <input
                      checked={settings.allowLateJoin}
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({ ...settings, allowLateJoin: event.target.checked });
                      }}
                      type="checkbox"
                    />
                    Allow participants to join after the first {uxBeta ? "question" : "checkpoint"}{" "}
                    starts
                  </label>
                </section>

                <section className="panel">
                  <p className="eyebrow">Experience</p>
                  <h2 style={{ fontSize: "1.8rem" }}>Look, motion, and sound</h2>
                  {roundExperiencesAvailable ? (
                    <>
                      <ExperiencePicker
                        category={publishedContent?.category ?? "general"}
                        onPresetChange={(preset) => {
                          setRecipe("custom");
                          setExperiencePreset(preset);
                        }}
                        presetId={experiencePreset}
                        showCategory={false}
                      />
                      <label className="checkbox-field">
                        <input
                          checked={presenterSoundEnabled}
                          onChange={(event) => {
                            setRecipe("custom");
                            setPresenterSoundEnabled(event.target.checked);
                          }}
                          type="checkbox"
                        />
                        Enable optional presenter sound cues
                      </label>
                      <small className="muted">
                        Sound is off by default and never carries information that is not shown
                        visually.
                      </small>
                    </>
                  ) : (
                    <p className="notice">
                      Round Experiences are not enabled for this workspace. This session will use
                      the accessible Focus preset without sound.
                    </p>
                  )}
                  <hr className="staff-divider" />
                  <h3>Scoring and results</h3>
                  <label className="field" htmlFor="scoring-mode">
                    <span>Scoring mode</span>
                    <select
                      className="select"
                      id="scoring-mode"
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({
                          ...settings,
                          scoringMode: event.target.value as SessionSettings["scoringMode"],
                        });
                      }}
                      value={settings.scoringMode}
                    >
                      <option value="accuracy">Accuracy — full points for a correct answer</option>
                      <option value="speed">
                        Competitive — correct and faster answers score more
                      </option>
                    </select>
                  </label>
                  <label className="field" htmlFor="result-visibility">
                    <span>Results during the round</span>
                    <select
                      className="select"
                      id="result-visibility"
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({
                          ...settings,
                          resultVisibility: event.target
                            .value as SessionSettings["resultVisibility"],
                        });
                      }}
                      value={settings.resultVisibility}
                    >
                      <option value="private">
                        Private — each participant sees only their result
                      </option>
                      <option value="leaderboard">Leaderboard — standings may be shown</option>
                    </select>
                  </label>
                  <label className="field" htmlFor="nickname-policy">
                    <span>Participant names</span>
                    <select
                      className="select"
                      id="nickname-policy"
                      onChange={(event) => {
                        setRecipe("custom");
                        setSettings({
                          ...settings,
                          nicknamePolicy: event.target.value as SessionSettings["nicknamePolicy"],
                        });
                      }}
                      value={settings.nicknamePolicy}
                    >
                      <option value="friendly_only">Assign privacy-friendly aliases</option>
                      <option value="custom">Allow participant-entered nicknames</option>
                    </select>
                  </label>
                </section>
              </div>
            </SetupReview>
            <section className="panel" style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: "1.6rem" }}>Ready to create the lobby?</h2>
              <p className="muted">
                The session will use the current immutable published version. You can review the
                room code, QR link, roster, and presenter screen before starting.
              </p>
              <div className="button-row">
                <button className="button" disabled={busy} type="submit">
                  {busy ? "Creating lobby…" : "Create live session"}
                </button>
                <Link className="button-quiet" href="/dashboard">
                  Cancel
                </Link>
              </div>
            </section>
          </form>
        )}
      </main>
    </>
  );
}
