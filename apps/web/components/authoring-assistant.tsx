"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthoringJob, AuthoringSourceType } from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import { recordCreationEvent } from "./workspace/product-events";

interface AuthoringStatus {
  enabled: boolean;
  monthlyLimit: number | null;
  used: number;
  remaining: number | null;
}

interface AuthoringAssistantProps {
  canEdit: boolean;
  plain?: boolean;
  trackCreation?: boolean;
  terminology?: "legacy" | "round";
}

const sourceTypes: Record<
  Exclude<AuthoringSourceType, "pasted_text">,
  { mimeType: string; label: string }
> = {
  pdf: { mimeType: "application/pdf", label: "PDF" },
  docx: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word",
  },
  pptx: {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "PowerPoint",
  },
};

function fileType(file: File) {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  return extension === "pdf" || extension === "docx" || extension === "pptx" ? extension : null;
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The source file could not be read."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("The source file could not be encoded."));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function statusLabel(status: AuthoringJob["status"]) {
  if (status === "pending") return "Waiting";
  if (status === "processing") return "Creating draft";
  if (status === "ready") return "Ready to review";
  return "Needs attention";
}

export function AuthoringAssistant({
  canEdit,
  plain = false,
  trackCreation = false,
  terminology = "legacy",
}: AuthoringAssistantProps) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthoringStatus | null>(null);
  const [jobs, setJobs] = useState<AuthoringJob[]>([]);
  const [sourceMode, setSourceMode] = useState<"pasted_text" | "file">("pasted_text");
  const [sourceName, setSourceName] = useState("Pasted source");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [statusResult, jobResult] = await Promise.all([
        apiFetch<{ status: AuthoringStatus }>("/v1/authoring/status"),
        apiFetch<{ jobs: AuthoringJob[] }>("/v1/authoring/jobs"),
      ]);
      if (!mounted.current) return;
      setStatus(statusResult.status);
      setJobs(jobResult.jobs);
    } catch (caught) {
      if (mounted.current) setError(humanError(caught));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "pending" || job.status === "processing")) return;
    const timer = window.setTimeout(() => void refresh(), 2_000);
    return () => window.clearTimeout(timer);
  }, [jobs, refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (trackCreation) recordCreationEvent("creation_started", "source");
    try {
      let body: Record<string, unknown>;
      if (sourceMode === "pasted_text") {
        body = { sourceType: "pasted_text", sourceName, text };
      } else {
        if (!file) throw new Error("Choose a PDF, Word, or PowerPoint source file.");
        if (file.size > 6_000_000) throw new Error("Source files must be 6 MB or smaller.");
        const type = fileType(file);
        if (!type) throw new Error("Choose a .pdf, .docx, or .pptx file.");
        body = {
          sourceType: type,
          sourceName: file.name,
          mimeType: sourceTypes[type].mimeType,
          encoding: "base64",
          data: await readBase64(file),
        };
      }
      const result = await apiFetch<{ job: AuthoringJob }>("/v1/authoring/jobs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setJobs((current) => [result.job, ...current.filter((job) => job.id !== result.job.id)]);
      setText("");
      setFile(null);
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function apply(job: AuthoringJob) {
    setApplyingId(job.id);
    setError("");
    try {
      const result = await apiFetch<{ quiz: { id: string } }>(
        `/v1/authoring/jobs/${job.id}/apply`,
        { method: "POST", body: "{}" },
      );
      if (trackCreation) recordCreationEvent("creation_completed", "source");
      router.push(`/quiz/${result.quiz.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setApplyingId("");
    }
  }

  const allowance = status
    ? status.monthlyLimit === null
      ? `${status.used} job${status.used === 1 ? "" : "s"} created this month; operator-configured allowance`
      : `${status.used} of ${status.monthlyLimit} source-grounded jobs used this month`
    : "Loading authoring availability…";

  return (
    <details className={plain ? "authoring-assistant" : "panel authoring-assistant"}>
      <summary>
        Draft {terminology === "round" ? "questions" : "checkpoints"} from a trusted source
      </summary>
      <p className="muted">
        OpenRound can propose a main {terminology === "round" ? "question" : "checkpoint"} and
        linked recheck from pasted text or a private PDF, Word, or PowerPoint file. Every proposal
        includes source citations and remains an unpublished draft until you review it.
      </p>
      <p className="notice" aria-live="polite">
        {allowance}
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {status && !status.enabled ? (
        <p className="notice">
          The authoring assistant is disabled on this deployment. An operator can enable an approved
          OpenAI-compatible provider; no source is sent anywhere while it is disabled.
        </p>
      ) : canEdit ? (
        <form onSubmit={submit}>
          <fieldset disabled={busy || status?.remaining === 0}>
            <legend>Source type</legend>
            <div className="button-row" role="group" aria-label="Source type">
              <label className="checkbox-field">
                <input
                  checked={sourceMode === "pasted_text"}
                  name="authoring-source-mode"
                  onChange={() => setSourceMode("pasted_text")}
                  type="radio"
                />
                Paste text
              </label>
              <label className="checkbox-field">
                <input
                  checked={sourceMode === "file"}
                  name="authoring-source-mode"
                  onChange={() => setSourceMode("file")}
                  type="radio"
                />
                Upload a private file
              </label>
            </div>
            {sourceMode === "pasted_text" ? (
              <>
                <label className="field">
                  <span>Source name</span>
                  <input
                    className="input"
                    maxLength={200}
                    onChange={(event) => setSourceName(event.target.value)}
                    required
                    value={sourceName}
                  />
                </label>
                <label className="field">
                  <span>Trusted source text</span>
                  <textarea
                    className="textarea"
                    maxLength={100_000}
                    minLength={50}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Paste at least 50 characters from the material participants should understand."
                    required
                    rows={8}
                    value={text}
                  />
                </label>
              </>
            ) : (
              <label className="field">
                <span>Private source file</span>
                <input
                  accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  className="input"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  required
                  type="file"
                />
                <small>
                  PDF, DOCX, or PPTX; 6 MB maximum. Arbitrary web URLs are not accepted.
                </small>
              </label>
            )}
            <button className="button" type="submit">
              {busy ? "Uploading source…" : "Create review proposal"}
            </button>
          </fieldset>
        </form>
      ) : (
        <p className="notice">Viewer access can inspect proposals but cannot create drafts.</p>
      )}

      {jobs.length ? (
        <div className="authoring-job-list" aria-label="Recent authoring proposals">
          <h3>Recent proposals</h3>
          {jobs.map((job) => (
            <article className="card" key={job.id}>
              <div className="button-row authoring-job-heading">
                <div>
                  <strong>{job.sourceName}</strong>
                  <p className="muted">
                    {statusLabel(job.status)} · attempt {job.attempts}
                  </p>
                </div>
                <span className="status-pill">{job.status}</span>
              </div>
              {job.error ? (
                <p className="error" role="status">
                  Proposal could not be created: {job.error}
                </p>
              ) : null}
              {job.output ? (
                <div className="authoring-proposal">
                  <h4>{job.output.checkpointSet.title}</h4>
                  {job.output.checkpointSet.questions.map((question) => (
                    <section key={question.id}>
                      <p>
                        <strong>
                          {question.delivery === "recheck"
                            ? "Linked recheck"
                            : terminology === "round"
                              ? "Main question"
                              : "Main checkpoint"}
                          :
                        </strong>{" "}
                        {question.prompt}
                      </p>
                      <ul>
                        {job.output?.citations
                          .filter((citation) => citation.checkpointId === question.id)
                          .map((citation) => (
                            <li key={`${citation.locator}-${citation.excerpt}`}>
                              <strong>{citation.locator}:</strong> “{citation.excerpt}”
                            </li>
                          ))}
                      </ul>
                    </section>
                  ))}
                  <p className="muted">
                    Generated by {job.output.provider} / {job.output.model}. Check every answer,
                    rationale, and citation against the source before publishing.
                  </p>
                  {job.appliedQuizId ? (
                    <Link className="button-quiet" href={`/quiz/${job.appliedQuizId}`}>
                      Open review draft
                    </Link>
                  ) : canEdit ? (
                    <button
                      className="button"
                      disabled={applyingId === job.id}
                      onClick={() => void apply(job)}
                      type="button"
                    >
                      {applyingId === job.id
                        ? "Creating draft…"
                        : "Create unpublished review draft"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </details>
  );
}
