"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type {
  Entitlements,
  ExperiencePresetId,
  QuizDraft,
  SessionSettings,
  SessionSnapshot,
} from "@openround/contracts";
import { Brand } from "../../../../components/brand";
import { ExperiencePicker } from "../../../../components/experience-picker";
import { apiFetch, humanError } from "../../../../lib/api";

interface Creator {
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
          setError("Publish this checkpoint set before creating a live round.");
          return;
        }
        setQuiz(quizResponse.quiz);
        setPublishedContent(quizResponse.currentVersion.content);
        setEntitlements(account.entitlements);
        setSettings(defaultsFor(account.creator, account.entitlements));
        setRoundExperiencesAvailable(account.productFeatures.roundExperiences);
        setExperiencePreset(
          account.productFeatures.roundExperiences
            ? (quizResponse.currentVersion.content.experiencePreset?.id ?? "focus")
            : "focus",
        );
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [quizId, router]);

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
      <header className="shell topbar">
        <Brand />
        <div className="button-row">
          {quiz ? (
            <Link className="button-quiet small-button" href={`/quiz/${quiz.id}/preview`}>
              Preview checkpoint set
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
                    onChange={(event) =>
                      setSettings({ ...settings, audienceLimit: Number(event.target.value) })
                    }
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
                    onChange={(event) =>
                      setSettings({ ...settings, allowLateJoin: event.target.checked })
                    }
                    type="checkbox"
                  />
                  Allow participants to join after the first checkpoint starts
                </label>
              </section>

              <section className="panel">
                <p className="eyebrow">Experience</p>
                <h2 style={{ fontSize: "1.8rem" }}>Look, motion, and sound</h2>
                {roundExperiencesAvailable ? (
                  <>
                    <ExperiencePicker
                      category={publishedContent?.category ?? "general"}
                      onPresetChange={setExperiencePreset}
                      presetId={experiencePreset}
                      showCategory={false}
                    />
                    <label className="checkbox-field">
                      <input
                        checked={presenterSoundEnabled}
                        onChange={(event) => setPresenterSoundEnabled(event.target.checked)}
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
                    Round Experiences are not enabled for this workspace. This session will use the
                    accessible Focus preset without sound.
                  </p>
                )}
                <hr className="staff-divider" />
                <h3>Scoring and results</h3>
                <label className="field" htmlFor="scoring-mode">
                  <span>Scoring mode</span>
                  <select
                    className="select"
                    id="scoring-mode"
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        scoringMode: event.target.value as SessionSettings["scoringMode"],
                      })
                    }
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
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        resultVisibility: event.target.value as SessionSettings["resultVisibility"],
                      })
                    }
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
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        nicknamePolicy: event.target.value as SessionSettings["nicknamePolicy"],
                      })
                    }
                    value={settings.nicknamePolicy}
                  >
                    <option value="friendly_only">Assign privacy-friendly aliases</option>
                    <option value="custom">Allow participant-entered nicknames</option>
                  </select>
                </label>
              </section>
            </div>
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
