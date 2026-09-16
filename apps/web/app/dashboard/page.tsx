"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Entitlements, QuizDraft } from "@openround/contracts";
import { Brand } from "../../components/brand";
import { apiFetch, humanError } from "../../lib/api";

interface Creator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  plan: "free" | "pro" | "team";
}

interface QuizRecord {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
  updatedAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([]);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(
    async (includeArchived: boolean) => {
      try {
        const [me, list] = await Promise.all([
          apiFetch<{ creator: Creator; entitlements: Entitlements }>("/v1/auth/me"),
          apiFetch<{ quizzes: QuizRecord[] }>(
            `/v1/quizzes${includeArchived ? "?archived=true" : ""}`,
          ),
        ]);
        setCreator(me.creator);
        setEntitlements(me.entitlements);
        setQuizzes(list.quizzes);
      } catch (caught) {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    setLoading(true);
    void refresh(showArchived);
  }, [refresh, showArchived]);

  async function createQuiz(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await apiFetch<{ quiz: QuizRecord }>("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({ title, description: "" }),
      });
      router.push(`/quiz/${response.quiz.id}`);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function duplicate(quizId: string) {
    setBusyId(quizId);
    try {
      await apiFetch(`/v1/quizzes/${quizId}/duplicate`, { method: "POST", body: "{}" });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function setArchived(quizId: string, archived: boolean) {
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived }),
      });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  function host(quizId: string) {
    if (!creator || !entitlements) return;
    router.push(`/host/setup/${quizId}`);
  }

  async function logout() {
    await apiFetch("/v1/auth/logout", { method: "POST", body: "{}" });
    router.replace("/");
  }

  async function upgrade() {
    try {
      const result = await apiFetch<{ url: string }>("/v1/billing/checkout", {
        method: "POST",
        body: "{}",
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleQuizzes = quizzes.filter(
    (quiz) =>
      !normalizedSearch ||
      quiz.title.toLocaleLowerCase().includes(normalizedSearch) ||
      quiz.description.toLocaleLowerCase().includes(normalizedSearch),
  );
  const publishedQuizCount = quizzes.filter((quiz) => quiz.status === "published").length;

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <nav className="button-row" aria-label="Account navigation">
          <Link href="/account">Account</Link>
          <Link href="/pricing">
            {creator?.plan === "free" ? "Free plan" : `${creator?.plan} plan`}
          </Link>
          <button className="button-quiet small-button" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </nav>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Creator workspace</p>
            <h1>Your quizzes</h1>
            <p className="muted">
              {creator ? `${creator.email} · ${creator.segment}` : "Loading workspace…"}
            </p>
          </div>
          {creator?.plan === "free" ? (
            <button className="button-quiet" onClick={() => void upgrade()} type="button">
              Explore Pro
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {entitlements && entitlements.maxPublishedQuizzes !== null ? (
          <p className="notice">
            {publishedQuizCount} of {entitlements.maxPublishedQuizzes} published quiz slots used on
            the {entitlements.plan} plan. Draft and archived quizzes do not use a slot.
          </p>
        ) : null}
        <section className="panel" style={{ marginBottom: 28 }} aria-labelledby="new-quiz-heading">
          <h2 id="new-quiz-heading" style={{ fontSize: "1.5rem" }}>
            Start a new quiz
          </h2>
          <form className="toolbar" onSubmit={createQuiz}>
            <label className="field" style={{ flex: "1 1 280px", marginBottom: 0 }}>
              <span>Quiz title</span>
              <input
                className="input"
                disabled={loading || !creator}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Friday knowledge check"
                required
                value={title}
              />
            </label>
            <button
              className="button"
              disabled={loading || !creator}
              style={{ alignSelf: "end" }}
              type="submit"
            >
              Create quiz
            </button>
          </form>
        </section>
        <section className="library-controls" aria-label="Quiz library filters">
          <label className="field library-search">
            <span>Search quizzes</span>
            <input
              className="input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or description"
              type="search"
              value={search}
            />
          </label>
          <label className="checkbox-field">
            <input
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              type="checkbox"
            />
            Include archived quizzes
          </label>
        </section>
        {loading ? <p>Loading quizzes…</p> : null}
        {!loading && visibleQuizzes.length === 0 ? (
          <section className="panel">
            <h2 style={{ fontSize: "1.6rem" }}>
              {quizzes.length === 0 ? "Your first round starts here." : "No quizzes match."}
            </h2>
            <p className="muted">
              {quizzes.length === 0
                ? "Create a quiz above, add a few focused questions, and publish it when it is ready."
                : "Try a different search or include archived quizzes."}
            </p>
          </section>
        ) : null}
        <section className="quiz-grid" aria-label="Quiz library">
          {visibleQuizzes.map((quiz) => (
            <article className="card quiz-card" key={quiz.id}>
              <div>
                <span className="status-pill">{quiz.status}</span>
              </div>
              <h2 style={{ fontSize: "1.65rem", marginTop: 18 }}>{quiz.title}</h2>
              <p>
                {quiz.draft.questions.length} question{quiz.draft.questions.length === 1 ? "" : "s"}
              </p>
              <div className="button-row">
                {quiz.status !== "archived" ? (
                  <Link className="button-quiet small-button" href={`/quiz/${quiz.id}`}>
                    Edit
                  </Link>
                ) : null}
                {quiz.currentVersionId && quiz.status !== "archived" ? (
                  <button
                    className="button small-button"
                    disabled={busyId === quiz.id || !entitlements}
                    onClick={() => void host(quiz.id)}
                    type="button"
                  >
                    Host
                  </button>
                ) : null}
                <button
                  className="button-quiet small-button"
                  disabled={busyId === quiz.id}
                  onClick={() => void duplicate(quiz.id)}
                  type="button"
                >
                  Duplicate
                </button>
                {quiz.status === "archived" ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void setArchived(quiz.id, false)}
                    type="button"
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    className="danger-link"
                    disabled={busyId === quiz.id}
                    onClick={() => void setArchived(quiz.id, true)}
                    type="button"
                  >
                    Archive
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
