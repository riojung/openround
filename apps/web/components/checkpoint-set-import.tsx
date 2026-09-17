"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { ImportValidationReport } from "@openround/contracts";
import { API_URL } from "../lib/api";

type ImportFormat = ImportValidationReport["format"];

interface ImportResponse {
  quiz?: { id: string; title: string };
  validation?: ImportValidationReport;
  error?: { message?: string };
}

interface CheckpointSetImportProps {
  enabled: boolean;
  onImported: () => Promise<void>;
  onUpgrade: () => void;
}

const formatHelp: Record<ImportFormat, string> = {
  openround_json: "Paste an OpenRound checkpoint-set export or choose its .json file.",
  csv: "Paste an OpenRound CSV export or choose its .csv file.",
  bulk: "Separate checkpoints with a blank line. Start choices with '* ' for correct or '- ' for incorrect.",
  qti3: "Choose a QTI 3 ZIP package. Selected response, multi-select, true/false, and numeric items are supported.",
};

const formatAccept: Record<ImportFormat, string> = {
  openround_json: ".json,application/json",
  csv: ".csv,text/csv",
  bulk: ".txt,text/plain",
  qti3: ".zip,application/zip,application/x-zip-compressed",
};

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The selected file could not be read"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("The selected file could not be encoded"));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function CheckpointSetImport({ enabled, onImported, onUpgrade }: CheckpointSetImportProps) {
  const [format, setFormat] = useState<ImportFormat>("openround_json");
  const [title, setTitle] = useState("");
  const [data, setData] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [validation, setValidation] = useState<ImportValidationReport | null>(null);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setError("");
    setMessage("");
    setValidation(null);
    const fileLimit = format === "qti3" ? 6_000_000 : 2_000_000;
    if (file.size > fileLimit) {
      setError(`This file is larger than the ${format === "qti3" ? "6" : "2"} MB import limit.`);
      event.currentTarget.value = "";
      return;
    }
    try {
      setData(format === "qti3" ? await fileAsBase64(file) : await file.text());
      setMessage(`${file.name} is ready to validate.`);
      event.currentTarget.value = "";
    } catch {
      setError("The selected file could not be read. Try saving it as UTF-8 text.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setValidation(null);
    try {
      const response = await fetch(`${API_URL}/v1/quizzes/import`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format,
          data,
          encoding: format === "qti3" ? "base64" : "text",
          ...(title.trim() ? { title: title.trim() } : {}),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as ImportResponse;
      if (result.validation) setValidation(result.validation);
      if (!response.ok || !result.quiz) {
        throw new Error(
          result.error?.message ?? `The checkpoint set could not be imported (${response.status}).`,
        );
      }
      setMessage(
        `${result.quiz.title} was imported as a draft with ${result.validation?.importedCheckpoints ?? 0} checkpoints.`,
      );
      setData("");
      setTitle("");
      await onImported();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The checkpoint set could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel portability-panel" aria-labelledby="import-heading">
      <div className="portability-heading">
        <div>
          <p className="eyebrow">Portable by design</p>
          <h2 id="import-heading">Import a checkpoint set</h2>
        </div>
        <span className="status-pill">Draft only</span>
      </div>
      <p className="muted">
        Imports are validated before anything is saved. Unsupported or incomplete content is listed
        explicitly for review.
      </p>
      {!enabled ? (
        <div className="notice">
          <p>Import and checkpoint-set exports are included with Hosted Pro.</p>
          <button className="button-quiet small-button" onClick={onUpgrade} type="button">
            Explore Pro
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="portability-fields">
            <label className="field">
              <span>Import format</span>
              <select
                className="select"
                onChange={(event) => {
                  setFormat(event.target.value as ImportFormat);
                  setData("");
                  setValidation(null);
                  setMessage("");
                  setError("");
                }}
                value={format}
              >
                <option value="openround_json">OpenRound JSON</option>
                <option value="csv">OpenRound CSV</option>
                <option value="bulk">Bulk paste</option>
                <option value="qti3">QTI 3 package</option>
              </select>
            </label>
            <label className="field">
              <span>New title (optional)</span>
              <input
                className="input"
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Keep the source title"
                value={title}
              />
            </label>
            <label className="field">
              <span>
                {format === "qti3"
                  ? "Choose a QTI 3 ZIP package"
                  : "Choose a UTF-8 file (optional)"}
              </span>
              <input
                accept={formatAccept[format]}
                onChange={(event) => void chooseFile(event)}
                required={format === "qti3" && !data}
                type="file"
              />
            </label>
          </div>
          {format === "qti3" ? (
            <p className="notice" role="status">
              {data
                ? "QTI package loaded and ready to validate."
                : "Select a ZIP package to continue."}
            </p>
          ) : (
            <label className="field">
              <span>Import content</span>
              <textarea
                aria-describedby="import-format-help"
                className="textarea portability-source"
                maxLength={2_000_000}
                onChange={(event) => setData(event.target.value)}
                placeholder={
                  format === "bulk"
                    ? "What is the safest action?\n* Follow the complete procedure\n- Take a shortcut"
                    : `Paste ${format === "csv" ? "CSV" : "JSON"} content here`
                }
                required
                value={data}
              />
            </label>
          )}
          <p className="muted" id="import-format-help">
            {formatHelp[format]}
          </p>
          <button className="button" disabled={busy || !data.trim()} type="submit">
            {busy ? "Validating…" : "Validate and import draft"}
          </button>
        </form>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="success" role="status">
          {message}
        </p>
      ) : null}
      {validation && (validation.errors.length > 0 || validation.warnings.length > 0) ? (
        <div className="import-validation" aria-live="polite">
          <h3>Validation details</h3>
          <ul>
            {[...validation.errors, ...validation.warnings].map((item, index) => (
              <li key={`${item.code}-${item.row ?? "set"}-${item.field ?? "content"}-${index}`}>
                <strong>{item.severity === "error" ? "Error" : "Warning"}:</strong>{" "}
                {item.row ? `row ${item.row}, ` : ""}
                {item.field ? `${item.field}: ` : ""}
                {item.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
