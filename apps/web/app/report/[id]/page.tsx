"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { Entitlements, Followup, Report, ReportV2 } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { API_URL, apiFetch, humanError } from "../../../lib/api";

function EvidenceSections({ report }: { report: ReportV2 }) {
  const recovered = report.recovery.reduce((total, item) => total + item.recovered, 0);
  const recoveryDenominator = report.recovery.reduce(
    (total, item) => total + item.initiallyIncorrectWithBoth,
    0,
  );
  return (
    <>
      <p className="notice" style={{ marginBottom: 26 }}>
        {report.evidenceNote}
      </p>
      <section className="metric-grid" aria-label="Recovery evidence" style={{ marginBottom: 26 }}>
        <div className="metric">
          <strong>{report.initialAccuracy.percent}%</strong>
          <span>initial accuracy</span>
        </div>
        <div className="metric">
          <strong>{report.participation.percent}%</strong>
          <span>participation</span>
        </div>
        <div className="metric">
          <strong>
            {recovered}/{recoveryDenominator}
          </strong>
          <span>recovered in rechecks</span>
        </div>
        <div className="metric">
          <strong>
            {report.unresolvedConcepts.filter((concept) => concept.unresolved > 0).length}
          </strong>
          <span>unresolved concepts</span>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: "1.7rem" }}>Recovery evidence</h2>
        {report.recovery.length === 0 ? (
          <p className="muted">No linked recheck or revote evidence was collected.</p>
        ) : (
          <div
            aria-label="Scrollable recovery evidence table"
            role="region"
            style={{ overflowX: "auto" }}
            tabIndex={0}
          >
            <table className="report-table">
              <thead>
                <tr>
                  <th>Evidence</th>
                  <th>Recovered</th>
                  <th>Initially incorrect with both</th>
                  <th>Rate</th>
                  <th>Strength</th>
                </tr>
              </thead>
              <tbody>
                {report.recovery.map((item) => (
                  <tr key={item.recheckRoundId}>
                    <td>{item.evidenceType === "linked_recheck" ? "Linked recheck" : "Revote"}</td>
                    <td>{item.recovered}</td>
                    <td>{item.initiallyIncorrectWithBoth}</td>
                    <td>
                      {item.recoveryPercent === null ? "Not available" : `${item.recoveryPercent}%`}
                    </td>
                    <td>{item.smallSample ? "Small sample" : "Larger sample"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: "1.7rem" }}>Confidence and correctness</h2>
        <div
          aria-label="Scrollable confidence matrix"
          role="region"
          style={{ overflowX: "auto" }}
          tabIndex={0}
        >
          <table className="report-table">
            <thead>
              <tr>
                <th>Confidence</th>
                <th>Correct</th>
                <th>Incorrect</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {report.confidenceMatrix.map((row) => (
                <tr key={row.confidence}>
                  <td>{["Not sure", "Somewhat sure", "Very sure"][row.confidence - 1]}</td>
                  <td>{row.correct}</td>
                  <td>{row.incorrect}</td>
                  <td>{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {report.unresolvedConcepts.length > 0 ? (
        <section className="panel" style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: "1.7rem" }}>Concept follow-up</h2>
          <div
            aria-label="Scrollable concept follow-up table"
            role="region"
            style={{ overflowX: "auto" }}
            tabIndex={0}
          >
            <table className="report-table">
              <thead>
                <tr>
                  <th>Concept</th>
                  <th>Initially incorrect</th>
                  <th>Recovered</th>
                  <th>Unresolved</th>
                </tr>
              </thead>
              <tbody>
                {report.unresolvedConcepts.map((concept) => (
                  <tr key={concept.conceptKey}>
                    <td>{concept.conceptKey}</td>
                    <td>{concept.initiallyIncorrect}</td>
                    <td>{concept.recovered}</td>
                    <td>{concept.unresolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {report.misconceptions.length > 0 ? (
        <section className="panel" style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: "1.7rem" }}>Observed misconceptions</h2>
          <ul>
            {report.misconceptions.map((item) => (
              <li key={`${item.questionId}:${item.key}`}>
                <strong>{item.key}</strong>: {item.responses} responses ({item.allResponsePercent}%
                of all; {item.wrongResponsePercent}% of incorrect responses)
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

interface FollowupAccessView {
  id: string;
  kind: "personal" | "accommodation";
  participantId: string | null;
  nickname: string | null;
  label: string;
  timeMultiplier: 1 | 1.5 | 2;
  expiresAt: string;
  revokedAt: string | null;
  url?: string;
}

interface CreatedFollowup {
  followup: Followup;
  genericUrl: string;
  personalAccess: FollowupAccessView[];
}

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function csvCell(value: string) {
  const protectedValue = /^(?:\s*[=+@-]|[\t\r\n])/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function FollowupBuilder({
  report,
  entitlement,
  initialFollowup,
}: {
  report: ReportV2;
  entitlement: boolean;
  initialFollowup: Followup | null;
}) {
  const unresolved = report.unresolvedConcepts.filter((concept) => concept.unresolved > 0);
  const [followup, setFollowup] = useState(initialFollowup);
  const [selected, setSelected] = useState(() => unresolved.map((concept) => concept.conceptKey));
  const [timeMode, setTimeMode] = useState<"flex" | "timed">("flex");
  const maximumClose = new Date(new Date(report.expiresAt).getTime() - 60_000);
  const suggestedClose = new Date(
    Math.min(Date.now() + 7 * 24 * 60 * 60_000, maximumClose.getTime()),
  );
  const [closesAt, setClosesAt] = useState(localDateTimeValue(suggestedClose));
  const [access, setAccess] = useState<FollowupAccessView[]>([]);
  const [created, setCreated] = useState<CreatedFollowup | null>(null);
  const [passLabel, setPassLabel] = useState("Extended time");
  const [passMultiplier, setPassMultiplier] = useState<1.5 | 2>(1.5);
  const [latestPass, setLatestPass] = useState<FollowupAccessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!followup) return;
    let cancelled = false;
    void apiFetch<{ access: FollowupAccessView[] }>(`/v1/followups/${followup.id}`)
      .then((result) => {
        if (!cancelled) setAccess(result.access);
      })
      .catch((caught) => {
        if (!cancelled) setError(humanError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [followup]);

  async function createFollowup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<CreatedFollowup>(`/v1/reports/${report.id}/followups`, {
        method: "POST",
        body: JSON.stringify({
          conceptKeys: selected,
          timeMode,
          closesAt: new Date(closesAt).toISOString(),
        }),
      });
      setFollowup(result.followup);
      setCreated(result);
      setAccess(result.personalAccess);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createPass(event: FormEvent) {
    event.preventDefault();
    if (!followup) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ access: FollowupAccessView }>(
        `/v1/followups/${followup.id}/accommodation-passes`,
        {
          method: "POST",
          body: JSON.stringify({ label: passLabel, timeMultiplier: passMultiplier }),
        },
      );
      setLatestPass(result.access);
      setAccess((current) => [...current, result.access]);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(accessId: string) {
    if (
      !followup ||
      !window.confirm("Revoke this follow-up pass? Its attempt will stop working.")
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/v1/followups/${followup.id}/access/${accessId}`, { method: "DELETE" });
      setAccess((current) =>
        current.map((item) =>
          item.id === accessId ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function closeFollowup() {
    if (!followup || !window.confirm("Close this follow-up for every participant?")) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/v1/followups/${followup.id}/close`, { method: "POST", body: "{}" });
      setFollowup({ ...followup, closedAt: new Date().toISOString() });
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  function downloadLinks() {
    if (!created) return;
    const rows = [
      ["access", "participant", "link"],
      ["generic", "Anonymous", created.genericUrl],
      ...created.personalAccess.map((item) => [
        "personal",
        item.nickname ?? item.label,
        item.url ?? "",
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `openround-followup-${created.followup.id}-links.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (!unresolved.length) return null;
  return (
    <section className="panel" style={{ marginBottom: 26 }} aria-labelledby="followup-heading">
      <p className="eyebrow">Continue the recovery loop</p>
      <h2 id="followup-heading" style={{ fontSize: "1.7rem" }}>
        Self-paced follow-up
      </h2>
      {!entitlement ? (
        <p className="notice">
          Signed follow-up links and private feedback are available with Hosted Pro and in the
          Community edition. <Link href="/pricing">Compare editions</Link>.
        </p>
      ) : followup ? (
        <>
          <p>
            <strong>{followup.title}</strong> contains {followup.checkpointCount} checkpoint
            {followup.checkpointCount === 1 ? "" : "s"} and closes on{" "}
            {new Date(followup.closesAt).toLocaleString()}.
          </p>
          <p className="muted">
            {followup.timeMode === "flex"
              ? "Time-flex mode has no countdown."
              : "Standard checkpoint timers are enforced by the server."}{" "}
            {followup.closedAt ? "This follow-up is closed." : "Links remain revocable."}
          </p>
          {created ? (
            <div className="notice">
              <strong>Save these links now.</strong> OpenRound stores only token hashes and cannot
              show the same links again.
              <div className="field" style={{ marginTop: 12 }}>
                <span>Generic anonymous link</span>
                <div className="toolbar">
                  <input className="input" readOnly value={created.genericUrl} />
                  <button
                    className="button-quiet small-button"
                    onClick={() => void navigator.clipboard.writeText(created.genericUrl)}
                    type="button"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <button className="button-quiet small-button" onClick={downloadLinks} type="button">
                Download all links as CSV
              </button>
            </div>
          ) : (
            <p className="notice">
              Access links were shown once when this follow-up was created. Create an accommodation
              pass below if a new individual link is needed.
            </p>
          )}

          {!followup.closedAt ? (
            <form onSubmit={createPass} className="toolbar" style={{ marginTop: 20 }}>
              <label className="field" style={{ flex: "1 1 220px" }}>
                <span>Accommodation pass label</span>
                <input
                  className="input"
                  maxLength={80}
                  onChange={(event) => setPassLabel(event.target.value)}
                  required
                  value={passLabel}
                />
              </label>
              <label className="field">
                <span>Time allowance</span>
                <select
                  className="select"
                  onChange={(event) => setPassMultiplier(Number(event.target.value) as 1.5 | 2)}
                  value={passMultiplier}
                >
                  <option value={1.5}>1.5×</option>
                  <option value={2}>2×</option>
                </select>
              </label>
              <button className="button-quiet" disabled={busy} type="submit">
                Create private pass
              </button>
            </form>
          ) : null}
          {latestPass?.url ? (
            <div className="notice">
              <strong>Save this new pass now:</strong>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <input className="input" readOnly value={latestPass.url} />
                <button
                  className="button-quiet small-button"
                  onClick={() => void navigator.clipboard.writeText(latestPass.url!)}
                  type="button"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : null}
          {access.length ? (
            <div
              style={{ overflowX: "auto" }}
              role="region"
              aria-label="Follow-up access passes"
              tabIndex={0}
            >
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Pass</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {access.map((item) => (
                    <tr key={item.id}>
                      <td>{item.nickname ?? item.label}</td>
                      <td>{item.timeMultiplier}×</td>
                      <td>{item.revokedAt ? "Revoked" : "Active"}</td>
                      <td>
                        {!item.revokedAt && !followup.closedAt ? (
                          <button
                            className="danger-link"
                            disabled={busy}
                            onClick={() => void revoke(item.id)}
                            type="button"
                          >
                            Revoke
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!followup.closedAt ? (
            <button
              className="danger-link"
              disabled={busy}
              onClick={() => void closeFollowup()}
              type="button"
            >
              Close follow-up for everyone
            </button>
          ) : null}
        </>
      ) : (
        <form onSubmit={createFollowup}>
          <p>Select the unresolved concepts to include. Linked rechecks are used when available.</p>
          <fieldset className="choice-list">
            <legend className="sr-only">Unresolved concepts</legend>
            {unresolved.map((concept) => (
              <label className="choice-row" key={concept.conceptKey}>
                <input
                  checked={selected.includes(concept.conceptKey)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, concept.conceptKey]
                        : current.filter((key) => key !== concept.conceptKey),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  <strong>{concept.conceptKey}</strong> — {concept.unresolved} unresolved
                </span>
              </label>
            ))}
          </fieldset>
          <div className="toolbar">
            <label className="field">
              <span>Timing</span>
              <select
                className="select"
                onChange={(event) => setTimeMode(event.target.value as "flex" | "timed")}
                value={timeMode}
              >
                <option value="flex">Time-flex, no countdown</option>
                <option value="timed">Use checkpoint timers</option>
              </select>
            </label>
            <label className="field">
              <span>Close date and time</span>
              <input
                className="input"
                max={localDateTimeValue(maximumClose)}
                min={localDateTimeValue(new Date())}
                onChange={(event) => setClosesAt(event.target.value)}
                required
                type="datetime-local"
                value={closesAt}
              />
            </label>
          </div>
          <button className="button" disabled={busy || selected.length === 0} type="submit">
            {busy ? "Creating…" : "Create follow-up and links"}
          </button>
        </form>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [followup, setFollowup] = useState<Followup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await apiFetch<{
          report: Report;
          entitlements: Entitlements;
          followup: Followup | null;
        }>(`/v1/reports/${id}`);
        if (cancelled) return;
        setReport(response.report);
        setEntitlements(response.entitlements);
        setFollowup(response.followup);
        setError("");
        if (response.report.status === "pending") retryTimer = setTimeout(load, 1_500);
      } catch (caught) {
        if (cancelled) return;
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, router]);

  const evidence = report?.schemaVersion === 2 ? report : null;

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
          {report?.status === "ready" && entitlements?.csvExport ? (
            <div className="button-row">
              <a className="button" href={`${API_URL}/v1/reports/${id}.csv`}>
                Download CSV
              </a>
              <a className="button-quiet" href={`${API_URL}/v1/reports/${id}.json`}>
                Download JSON
              </a>
            </div>
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
        {report?.status === "pending" ? (
          <section className="panel" aria-live="polite">
            <p className="eyebrow">Building evidence</p>
            <h2>Your report is being generated</h2>
            <p className="muted">
              OpenRound is reconciling durable responses, interventions, and rechecks. This page
              refreshes automatically and is normally ready within a minute.
            </p>
          </section>
        ) : null}
        {report?.status === "failed" ? (
          <p className="error" role="alert">
            Report generation could not finish. Contact support with report ID {report.id} so the
            job can be safely retried.
          </p>
        ) : null}
        {report?.status === "ready" ? (
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
                <span>difficult checkpoints</span>
              </div>
            </section>
            {evidence ? <EvidenceSections report={evidence} /> : null}
            {evidence && entitlements ? (
              <FollowupBuilder
                entitlement={entitlements.followups}
                initialFollowup={followup}
                report={evidence}
              />
            ) : null}
            <section className="panel" style={{ marginBottom: 26 }}>
              <h2 style={{ fontSize: "1.7rem" }}>Checkpoint analysis</h2>
              <div
                aria-label="Scrollable checkpoint analysis table"
                role="region"
                style={{ overflowX: "auto" }}
                tabIndex={0}
              >
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Checkpoint</th>
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
