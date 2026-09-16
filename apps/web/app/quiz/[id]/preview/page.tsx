"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BrandTheme, QuizDraft } from "@openround/contracts";
import { Brand } from "../../../../components/brand";
import { apiFetch, humanError } from "../../../../lib/api";
import { liveThemeStyle } from "../../../../lib/theme";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
}

export default function QuizPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [brandTheme, setBrandTheme] = useState<BrandTheme | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [mediaSource, setMediaSource] = useState("");
  const [error, setError] = useState("");
  const question = quiz?.draft.questions[questionIndex];

  useEffect(() => {
    Promise.all([
      apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`),
      apiFetch<{ brandTheme: BrandTheme | null }>("/v1/auth/me"),
    ])
      .then(([{ quiz: loadedQuiz }, account]) => {
        setQuiz(loadedQuiz);
        setBrandTheme(account.brandTheme);
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [id, router]);

  useEffect(() => {
    setRevealed(false);
    if (!question?.mediaId) {
      setMediaSource("");
      return;
    }
    let active = true;
    apiFetch<{ downloadUrl: string }>(`/v1/media/${question.mediaId}`)
      .then(({ downloadUrl }) => {
        if (active) setMediaSource(downloadUrl);
      })
      .catch(() => {
        if (active) setMediaSource("");
      });
    return () => {
      active = false;
    };
  }, [question?.id, question?.mediaId]);

  function move(direction: -1 | 1) {
    if (!quiz) return;
    setQuestionIndex((current) =>
      Math.min(Math.max(current + direction, 0), quiz.draft.questions.length - 1),
    );
  }

  return (
    <div
      className="live-shell"
      data-branded={brandTheme ? "true" : undefined}
      style={liveThemeStyle(brandTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={brandTheme?.organizationName} />
        <div className="button-row">
          <Link className="button-quiet small-button" href={`/quiz/${id}`}>
            Back to editor
          </Link>
          <Link className="button-quiet small-button" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </header>
      <main className="shell live-stage" id="main">
        {error ? (
          <section className="live-card">
            <p className="error" role="alert">
              {error}
            </p>
          </section>
        ) : null}
        {!quiz && !error ? (
          <section className="live-card">
            <p>Loading preview…</p>
          </section>
        ) : null}
        {quiz && !question ? (
          <section className="live-card">
            <p className="eyebrow">Participant preview</p>
            <h1>Add a question to preview this quiz.</h1>
            <Link className="button" href={`/quiz/${id}`}>
              Return to editor
            </Link>
          </section>
        ) : null}
        {quiz && question ? (
          <section className="live-card">
            <div className="page-heading" style={{ alignItems: "center", marginBottom: 20 }}>
              <div>
                <p className="eyebrow">Participant preview · {quiz.status}</p>
                <span className="status-pill">
                  Question {questionIndex + 1} of {quiz.draft.questions.length}
                </span>
              </div>
              <span className="countdown" aria-label={`${question.timeLimitSeconds} second timer`}>
                {question.timeLimitSeconds}s
              </span>
            </div>
            <h1 style={{ fontSize: "clamp(2rem, 7vw, 4rem)" }}>{question.prompt}</h1>
            {mediaSource ? (
              <img
                alt={question.mediaAlt ?? ""}
                className="question-media"
                height={360}
                src={mediaSource}
                width={640}
              />
            ) : null}
            <div className="answer-grid" aria-label="Answer choices">
              {question.choices.map((choice, index) => (
                <div
                  className="answer-button"
                  data-correct={(revealed && choice.isCorrect) || undefined}
                  key={choice.id}
                >
                  <span aria-hidden="true" style={{ marginRight: 10 }}>
                    {String.fromCharCode(65 + index)}.
                  </span>
                  {choice.label}
                </div>
              ))}
            </div>
            {revealed ? (
              <div className="success" role="status">
                <strong>Correct answer revealed</strong>
                {question.explanation ? <div>{question.explanation}</div> : null}
              </div>
            ) : null}
            <div className="button-row" style={{ marginTop: 28 }}>
              <button
                className="button-quiet"
                disabled={questionIndex === 0}
                onClick={() => move(-1)}
                type="button"
              >
                Previous question
              </button>
              <button
                className="button-quiet"
                onClick={() => setRevealed((current) => !current)}
                type="button"
              >
                {revealed ? "Hide answer" : "Reveal answer"}
              </button>
              <button
                className="button"
                disabled={questionIndex === quiz.draft.questions.length - 1}
                onClick={() => move(1)}
                type="button"
              >
                Next question
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
