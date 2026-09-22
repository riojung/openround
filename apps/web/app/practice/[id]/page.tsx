"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "../../../components/practice/practice.module.css";
import {
  recordFollowupShared,
  recordPracticeAssignmentShared,
} from "../../../components/workspace/product-events";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../../lib/api";
import {
  practicePurposeLabel,
  practiceStatus,
  type PracticeAccess,
  type PracticeRecord,
  type PracticeStatus,
} from "../../../lib/practice-assignment";

interface PracticeContext {
  quizId: string;
  quizTitle: string;
  version: number;
  publishedAt: string;
}

interface PracticeDetail {
  followup: PracticeRecord;
  access: PracticeAccess[];
  context: PracticeContext;
  attemptCount?: number;
  completedAttemptCount?: number;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function accessType(access: PracticeAccess) {
  if (access.kind === "accommodation") return access.timeMultiplier + "× accommodation";
  if (access.kind === "assignment_personal") return "Personal assignment link";
  return "Participant follow-up link";
}

function accessStatus(access: PracticeAccess, status: PracticeStatus) {
  if (access.revokedAt) return "Revoked";
  if (status === "expired") return "Expired";
  if (status === "closed") return "Closed";
  if (status === "scheduled") return "Scheduled";
  return "Active";
}

function PracticeManagementContent() {
  const { id } = useParams<{ id: string }>();
  const { productFeatures, entitlements, canEdit } = useWorkspace();
  const [detail, setDetail] = useState<PracticeDetail | null>(null);
  const [personalLabel, setPersonalLabel] = useState("");
  const [accommodationLabel, setAccommodationLabel] = useState("Extended time");
  const [timeMultiplier, setTimeMultiplier] = useState<1.5 | 2>(1.5);
  const [latestAccess, setLatestAccess] = useState<PracticeAccess | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const latestLinkHeadingRef = useRef<HTMLHeadingElement>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  const accessHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<PracticeDetail>("/v1/followups/" + id)
      .then((response) => {
        if (!cancelled) setDetail(response);
      })
      .catch((caught) => {
        if (!cancelled) setError(humanError(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function reportError(caught: unknown) {
    setError(humanError(caught));
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function createPersonalPass(event: FormEvent) {
    event.preventDefault();
    if (!detail || !personalLabel.trim() || entitlements?.followups !== true) return;
    setBusyAction("personal");
    setError("");
    setCopyStatus("");
    setActionStatus("");
    try {
      const response = await apiFetch<{ access: PracticeAccess }>(
        "/v1/followups/" + id + "/personal-passes",
        {
          method: "POST",
          body: JSON.stringify({ label: personalLabel.trim() }),
        },
      );
      setLatestAccess(response.access);
      setDetail({ ...detail, access: [...detail.access, response.access] });
      setPersonalLabel("");
      window.requestAnimationFrame(() => latestLinkHeadingRef.current?.focus());
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusyAction("");
    }
  }

  async function createAccommodation(event: FormEvent) {
    event.preventDefault();
    if (!detail || detail.followup.timeMode !== "timed") return;
    setBusyAction("accommodation");
    setError("");
    setCopyStatus("");
    setActionStatus("");
    try {
      const response = await apiFetch<{ access: PracticeAccess }>(
        "/v1/followups/" + id + "/accommodation-passes",
        {
          method: "POST",
          body: JSON.stringify({
            label: accommodationLabel.trim(),
            timeMultiplier,
          }),
        },
      );
      setLatestAccess(response.access);
      setDetail({ ...detail, access: [...detail.access, response.access] });
      window.requestAnimationFrame(() => latestLinkHeadingRef.current?.focus());
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusyAction("");
    }
  }

  async function revoke(accessId: string) {
    if (
      !detail ||
      !window.confirm("Revoke this private practice link? Its attempt will stop working.")
    ) {
      return;
    }
    setBusyAction(accessId);
    setError("");
    setActionStatus("");
    try {
      await apiFetch("/v1/followups/" + id + "/access/" + accessId, { method: "DELETE" });
      const revokedAccess = detail.access.find((access) => access.id === accessId);
      setDetail({
        ...detail,
        access: detail.access.map((access) =>
          access.id === accessId ? { ...access, revokedAt: new Date().toISOString() } : access,
        ),
      });
      if (latestAccess?.id === accessId) setLatestAccess(null);
      setActionStatus(
        `${revokedAccess?.nickname ?? revokedAccess?.label ?? "Private practice"} link revoked.`,
      );
      window.requestAnimationFrame(() => accessHeadingRef.current?.focus());
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusyAction("");
    }
  }

  async function closePractice() {
    if (!detail || !window.confirm("Close this practice for every participant?")) return;
    setBusyAction("close");
    setError("");
    setActionStatus("");
    try {
      await apiFetch("/v1/followups/" + id + "/close", { method: "POST", body: "{}" });
      setDetail({
        ...detail,
        followup: { ...detail.followup, closedAt: new Date().toISOString() },
      });
      setLatestAccess(null);
      setActionStatus("Practice closed for every participant.");
      window.requestAnimationFrame(() => summaryHeadingRef.current?.focus());
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusyAction("");
    }
  }

  async function copyLatestLink() {
    if (!latestAccess?.url) return;
    setError("");
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(latestAccess.url);
      if (detail?.followup.purpose === "assignment") recordPracticeAssignmentShared();
      else recordFollowupShared();
      setCopyStatus(latestAccess.label + " link copied.");
    } catch {
      setError("Copy was blocked. Select and copy the link instead.");
    }
  }

  const status = detail ? practiceStatus(detail.followup) : null;
  const mutable = canEdit && status !== "closed" && status !== "expired";
  const personalPassCreationAvailable = mutable && entitlements?.followups === true;

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/results?view=practice">
          Back to Practice
        </Link>
      }
      description="Review progress, create private access, or close this practice."
      eyebrow="Practice"
      requireBeta={false}
      title={detail?.followup.title ?? "Manage practice"}
      titleLanguage={detail?.followup.title ? "" : "en-CA"}
    >
      {error ? (
        <p className="error" ref={errorRef} role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      <p
        aria-atomic="true"
        aria-live="polite"
        className={actionStatus ? "success" : "sr-only"}
        role="status"
      >
        {actionStatus}
      </p>
      {loading ? (
        <p className={styles.muted} role="status">
          Loading practice…
        </p>
      ) : null}
      {!loading && detail ? (
        <div className={styles.stack}>
          <section className={styles.summaryCard} aria-labelledby="practice-summary-heading">
            <div className={styles.summaryHeader}>
              <div>
                <p className="eyebrow">{practicePurposeLabel(detail.followup.purpose)}</p>
                <h2 id="practice-summary-heading" ref={summaryHeadingRef} tabIndex={-1}>
                  {detail.context.quizTitle}
                </h2>
              </div>
              <div className={styles.statusGroup}>
                <span className="status-pill">{status}</span>
                <span className="status-pill">Published v{detail.context.version}</span>
              </div>
            </div>
            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <strong>{detail.followup.checkpointCount}</strong>
                <span>questions</span>
              </div>
              <div className={styles.metric}>
                <strong>{detail.attemptCount ?? "—"}</strong>
                <span>attempts</span>
              </div>
              <div className={styles.metric}>
                <strong>{detail.completedAttemptCount ?? "—"}</strong>
                <span>completed</span>
              </div>
            </div>
            <p>
              {detail.followup.timeMode === "flex"
                ? "Time-flex practice has no countdown."
                : "Published question timers are enforced by the server."}{" "}
              Opens {formatDate(detail.followup.opensAt)} and closes{" "}
              {formatDate(detail.followup.closesAt)}.
            </p>
            <p>Source version published {formatDate(detail.context.publishedAt)}.</p>
            {detail.followup.purpose === "assignment" &&
            productFeatures?.practiceAssignments !== true ? (
              <p className="notice">
                New standalone assignment access is paused for this workspace. Existing links,
                accommodations, revocation, and close controls remain available.
              </p>
            ) : null}
            <div className={styles.managementActions}>
              <Link
                className="button-quiet small-button"
                href={"/quiz/" + detail.context.quizId + (canEdit ? "" : "/preview")}
              >
                Open source Round
              </Link>
              {detail.followup.sourceReportId ? (
                <Link
                  className="button-quiet small-button"
                  href={"/report/" + detail.followup.sourceReportId}
                >
                  View source result
                </Link>
              ) : null}
            </div>
          </section>

          {latestAccess?.url ? (
            <section className={styles.receipt} aria-labelledby="latest-practice-link-heading">
              <p className="eyebrow">New private link</p>
              <h2 id="latest-practice-link-heading" ref={latestLinkHeadingRef} tabIndex={-1}>
                Save this link now
              </h2>
              <p>OpenRound stores only its token hash and cannot display this exact link again.</p>
              <div className={styles.linkRow}>
                <label className="field" htmlFor="latest-practice-link">
                  <span>{latestAccess.label}</span>
                  <input
                    className="input"
                    id="latest-practice-link"
                    readOnly
                    value={latestAccess.url}
                  />
                </label>
                <button
                  className="button-quiet small-button"
                  onClick={() => void copyLatestLink()}
                  type="button"
                >
                  Copy
                </button>
              </div>
              <p aria-live="polite" className={copyStatus ? "success" : "sr-only"} role="status">
                {copyStatus}
              </p>
            </section>
          ) : null}

          <section className={styles.accessCard} aria-labelledby="practice-access-heading">
            <h2 id="practice-access-heading" ref={accessHeadingRef} tabIndex={-1}>
              Private access
            </h2>
            <p>
              Original links are intentionally not retrievable.{" "}
              {detail.followup.purpose === "recovery"
                ? "These participant links came from the source session and can be revoked or accommodated here."
                : personalPassCreationAvailable && productFeatures?.practiceAssignments === true
                  ? "Create a new one-attempt personal link when an individual needs access."
                  : "Existing personal links remain available for status and revocation."}
            </p>
            {mutable &&
            detail.followup.purpose === "assignment" &&
            entitlements?.followups !== true ? (
              <div className="notice">
                <p>
                  Creating new personal assignment links requires Pro. Existing access can still be
                  reviewed or revoked, timing accommodations remain available for timed practice,
                  and you can close this practice at any time.
                </p>
                <Link className="button-quiet small-button" href="/pricing">
                  Compare plans
                </Link>
              </div>
            ) : null}
            {personalPassCreationAvailable &&
            detail.followup.purpose === "assignment" &&
            productFeatures?.practiceAssignments === true ? (
              <form className={styles.fields} onSubmit={createPersonalPass}>
                <label className="field" htmlFor="personal-pass-label">
                  <span>Personal link label</span>
                  <input
                    className="input"
                    id="personal-pass-label"
                    maxLength={80}
                    onChange={(event) => setPersonalLabel(event.target.value)}
                    required
                    value={personalLabel}
                  />
                </label>
                <button
                  className="button-quiet"
                  disabled={busyAction !== ""}
                  style={{ alignSelf: "end" }}
                  type="submit"
                >
                  {busyAction === "personal" ? "Creating…" : "Create personal link"}
                </button>
              </form>
            ) : null}

            {detail.access.length ? (
              <div
                aria-label="Practice access links"
                className={styles.accessTable}
                role="region"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Access</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.access.map((access) => (
                      <tr key={access.id}>
                        <td>{access.nickname ?? access.label}</td>
                        <td>{accessType(access)}</td>
                        <td>{accessStatus(access, practiceStatus(detail.followup))}</td>
                        <td>
                          {mutable && !access.revokedAt ? (
                            <button
                              className="danger-link"
                              disabled={busyAction !== ""}
                              onClick={() => void revoke(access.id)}
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
            ) : (
              <p className={styles.muted}>No private access links have been created.</p>
            )}
          </section>

          <section className={styles.accessCard} aria-labelledby="practice-accommodation-heading">
            <h2 id="practice-accommodation-heading">Timing accommodation</h2>
            {detail.followup.timeMode === "flex" ? (
              <p>
                This practice has no countdown, so every participant already has unlimited response
                time. No timing pass is needed.
              </p>
            ) : (
              <p>Create a private 1.5× or 2× pass without storing a reason.</p>
            )}
            {mutable && detail.followup.timeMode === "timed" ? (
              <form className={styles.fields} onSubmit={createAccommodation}>
                <label className="field" htmlFor="accommodation-label">
                  <span>Pass label</span>
                  <input
                    className="input"
                    id="accommodation-label"
                    maxLength={80}
                    onChange={(event) => setAccommodationLabel(event.target.value)}
                    required
                    value={accommodationLabel}
                  />
                </label>
                <label className="field" htmlFor="accommodation-time">
                  <span>Time allowance</span>
                  <select
                    className="select"
                    id="accommodation-time"
                    onChange={(event) => setTimeMultiplier(Number(event.target.value) as 1.5 | 2)}
                    value={timeMultiplier}
                  >
                    <option value={1.5}>1.5×</option>
                    <option value={2}>2×</option>
                  </select>
                </label>
                <button className="button-quiet" disabled={busyAction !== ""} type="submit">
                  {busyAction === "accommodation" ? "Creating…" : "Create accommodation pass"}
                </button>
              </form>
            ) : null}
          </section>

          {mutable ? (
            <section className={styles.accessCard} aria-labelledby="close-practice-heading">
              <h2 id="close-practice-heading">Close practice</h2>
              <p>Closing blocks every generic and private link immediately and cannot be undone.</p>
              <button
                className="button-danger"
                disabled={busyAction !== ""}
                onClick={() => void closePractice()}
                type="button"
              >
                {busyAction === "close" ? "Closing…" : "Close practice for everyone"}
              </button>
            </section>
          ) : null}
        </div>
      ) : null}
    </WorkspaceShell>
  );
}

export default function PracticeManagementPage() {
  return (
    <WorkspaceProvider>
      <PracticeManagementContent />
    </WorkspaceProvider>
  );
}
