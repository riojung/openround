"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LtiLaunchView } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { apiFetch, humanError } from "../../../lib/api";

interface QuizRecord {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
}

export default function LtiSelectPage() {
  const [launchId, setLaunchId] = useState("");
  const [launch, setLaunch] = useState<LtiLaunchView | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("launchId") ?? "";
    setLaunchId(id);
    if (!id) {
      setError("The deep-link launch identifier is missing.");
      return;
    }
    Promise.all([
      apiFetch<{ launch: LtiLaunchView }>(`/v1/lti/launches/${id}`),
      apiFetch<{ quizzes: QuizRecord[] }>("/v1/quizzes"),
    ])
      .then(([launchResult, quizResult]) => {
        if (launchResult.launch.messageType !== "LtiDeepLinkingRequest") {
          throw new Error("This LMS launch is not a content-selection request.");
        }
        const published = quizResult.quizzes.filter((quiz) => quiz.status === "published");
        setLaunch(launchResult.launch);
        setQuizzes(published);
        setSelectedQuizId(published[0]?.id ?? "");
      })
      .catch((caught) => setError(humanError(caught)));
  }, []);

  async function sendSelection() {
    if (!launchId || !selectedQuizId) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ returnUrl: string; jwt: string }>(
        `/v1/lti/launches/${launchId}/deep-link`,
        { method: "POST", body: JSON.stringify({ quizId: selectedQuizId }) },
      );
      const form = document.createElement("form");
      form.action = result.returnUrl;
      form.method = "POST";
      const jwt = document.createElement("input");
      jwt.type = "hidden";
      jwt.name = "JWT";
      jwt.value = result.jwt;
      form.append(jwt);
      document.body.append(form);
      form.submit();
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link href="/dashboard">Dashboard</Link>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">LTI deep linking</p>
            <h1>Add a checkpoint set to your LMS</h1>
            <p className="muted">
              Only published checkpoint sets can be returned. OpenRound sends one signed LTI
              resource link to the registered LMS return origin.
            </p>
          </div>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {launch ? (
          <section className="panel lti-selection-panel">
            <label className="field" htmlFor="lti-checkpoint-set">
              <span>Published checkpoint set</span>
              <select
                className="select"
                id="lti-checkpoint-set"
                onChange={(event) => setSelectedQuizId(event.target.value)}
                value={selectedQuizId}
              >
                {quizzes.map((quiz) => (
                  <option key={quiz.id} value={quiz.id}>
                    {quiz.title}
                  </option>
                ))}
              </select>
            </label>
            {quizzes.length === 0 ? (
              <p className="notice">
                Publish a checkpoint set before completing this LMS content-selection flow.
              </p>
            ) : null}
            <button
              className="button"
              disabled={busy || !selectedQuizId}
              onClick={() => void sendSelection()}
              type="button"
            >
              {busy ? "Returning to LMS…" : "Add to LMS"}
            </button>
          </section>
        ) : !error ? (
          <p className="muted">Loading the verified LMS request…</p>
        ) : null}
      </main>
    </>
  );
}
