"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Entitlements, Report } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { API_URL, apiFetch, humanError } from "../../../lib/api";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ report: Report; entitlements: Entitlements }>(`/v1/reports/${id}`)
      .then((response) => {
        setReport(response.report);
        setEntitlements(response.entitlements);
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [id, router]);

  async function deleteSession() {
    if (!report || !window.confirm("Delete this session, its answers, and this report?")) return;
    setDeleting(true);
    setError("");
    try {
      await apiFetch(`/v1/sessions/${report.sessionId}`, { method: "DELETE" });
      router.replace("/dashboard");
    } catch (caught) {
      setError(humanError(caught));
      setDeleting(false);
    }
  }

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link className="button-quiet small-button" href="/dashboard">
          Dashboard
        </Link>
      </header>
      <main className="shell page-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Session report</p>
            <h1>What the room understood</h1>
          </div>
          {report && entitlements?.csvExport ? (
            <a className="button" href={`${API_URL}/v1/reports/${id}.csv`}>
              Download CSV
            </a>
          ) : report && entitlements ? (
            <Link className="button-quiet" href="/pricing">
              CSV export requires Pro
            </Link>
          ) : null}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!report && !error ? <p>Loading report…</p> : null}
        {report ? (
          <>
            <p className="notice" style={{ marginBottom: 26 }}>
              This report&apos;s stored retention deadline is{" "}
              {new Date(report.expiresAt).toLocaleDateString()}. The current{" "}
              {entitlements?.plan ?? "account"} plan defaults to{" "}
              {entitlements?.reportRetentionDays ?? ""} days. You can delete it sooner below.
            </p>
            <section className="metric-grid" style={{ marginBottom: 26 }}>
              <div className="metric">
                <strong>{report.metrics.participantCount}</strong>
                <span>participants</span>
              </div>
              <div className="metric">
                <strong>{report.metrics.answerCount}</strong>
                <span>answers</span>
              </div>
              <div className="metric">
                <strong>{report.metrics.accuracyPercent}%</strong>
                <span>accuracy</span>
              </div>
              <div className="metric">
                <strong>{report.questions.filter((question) => question.difficult).length}</strong>
                <span>difficult questions</span>
              </div>
            </section>
            <section className="panel" style={{ marginBottom: 26 }}>
              <h2 style={{ fontSize: "1.7rem" }}>Question analysis</h2>
              <div
                aria-label="Scrollable question analysis table"
                role="region"
                style={{ overflowX: "auto" }}
                tabIndex={0}
              >
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th>Responses</th>
                      <th>Correct</th>
                      <th>Accuracy</th>
                      <th>Follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.questions.map((question) => (
                      <tr key={question.questionId}>
                        <td>{question.prompt}</td>
                        <td>{question.responses}</td>
                        <td>{question.correct}</td>
                        <td>{question.accuracyPercent}%</td>
                        <td>{question.difficult ? "Review" : "On track"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel" style={{ marginBottom: 26 }}>
              <h2 style={{ fontSize: "1.7rem" }}>Participant outcomes</h2>
              <div
                aria-label="Scrollable participant outcomes table"
                role="region"
                style={{ overflowX: "auto" }}
                tabIndex={0}
              >
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Nickname</th>
                      <th>Score</th>
                      <th>Correct</th>
                      <th>Answered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.participants
                      .sort((a, b) => b.score - a.score)
                      .map((participant) => (
                        <tr key={participant.participantId}>
                          <td>{participant.nickname}</td>
                          <td>{participant.score}</td>
                          <td>{participant.correctCount}</td>
                          <td>{participant.answerCount}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel danger-panel">
              <h2 style={{ fontSize: "1.5rem" }}>Delete session data</h2>
              <p className="muted">
                Permanently remove this session, its participant records, answers, and report.
              </p>
              <button
                className="button-danger"
                disabled={deleting}
                onClick={() => void deleteSession()}
                type="button"
              >
                {deleting ? "Deleting…" : "Delete session and report"}
              </button>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
