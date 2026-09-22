"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { ImportValidationReport } from "@openround/contracts";
import { API_URL } from "../lib/api";
import { formatNumber } from "../lib/i18n/format";
import { useLocale } from "./locale-provider";
import { recordAuthoringEvent, recordCreationEvent } from "./workspace/product-events";

type ImportFormat = ImportValidationReport["format"];

interface ImportResponse {
  quiz?: { id: string; title: string };
  validation?: ImportValidationReport;
  error?: { message?: string };
}

interface CheckpointSetImportProps {
  enabled: boolean;
  onImported: (quiz: { id: string; title: string }) => Promise<void>;
  onUpgrade: () => void;
  plain?: boolean;
  trackCreation?: boolean;
  terminology?: "legacy" | "round";
}

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

export function CheckpointSetImport({
  enabled,
  onImported,
  onUpgrade,
  plain = false,
  trackCreation = false,
  terminology = "legacy",
}: CheckpointSetImportProps) {
  const { locale, t } = useLocale();
  const [format, setFormat] = useState<ImportFormat>("openround_json");
  const [title, setTitle] = useState("");
  const [data, setData] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorIsRaw, setErrorIsRaw] = useState(false);
  const [validation, setValidation] = useState<ImportValidationReport | null>(null);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setError("");
    setErrorIsRaw(false);
    setMessage("");
    setValidation(null);
    const fileLimit = format === "qti3" ? 6_000_000 : 2_000_000;
    if (file.size > fileLimit) {
      setError(t("reportRound.import.fileTooLarge", { limit: format === "qti3" ? "6" : "2" }));
      setErrorIsRaw(false);
      event.currentTarget.value = "";
      return;
    }
    try {
      setData(format === "qti3" ? await fileAsBase64(file) : await file.text());
      setMessage(t("reportRound.import.fileReady", { file: file.name }));
      event.currentTarget.value = "";
    } catch {
      setError(t("reportRound.import.fileReadError"));
      setErrorIsRaw(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setErrorIsRaw(false);
    setMessage("");
    setValidation(null);
    if (trackCreation) recordCreationEvent("creation_started", "import", "round");
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
        if (result.error?.message) {
          setError(result.error.message);
          setErrorIsRaw(true);
          return;
        }
        throw new Error(
          t("reportRound.import.failedStatus", {
            artifact:
              terminology === "round" ? t("common.round") : t("reportRound.common.checkpointSet"),
            status: response.status,
          }),
        );
      }
      setMessage(
        t("reportRound.import.success", {
          title: result.quiz.title,
          count: formatNumber(locale, result.validation?.importedCheckpoints ?? 0),
          items:
            terminology === "round"
              ? t("reportRound.common.questions")
              : t("reportRound.common.checkpoints"),
        }),
      );
      if (trackCreation) {
        recordCreationEvent("creation_completed", "import", "round");
        if ((result.validation?.importedCheckpoints ?? 0) > 0) {
          recordAuthoringEvent("first_block_created", "round");
        }
      }
      setData("");
      setTitle("");
      await onImported(result.quiz);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("reportRound.import.failed", {
              artifact:
                terminology === "round" ? t("common.round") : t("reportRound.common.checkpointSet"),
            }),
      );
      setErrorIsRaw(!(caught instanceof Error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={plain ? "portability-panel" : "panel portability-panel"}
      aria-labelledby="import-heading"
    >
      <div className="portability-heading">
        <div>
          <p className="eyebrow">{t("reportRound.import.eyebrow")}</p>
          <h2 id="import-heading">
            {terminology === "round"
              ? t("reportRound.import.roundTitle")
              : t("reportRound.import.legacyTitle")}
          </h2>
        </div>
        <span className="status-pill">{t("reportRound.import.draftOnly")}</span>
      </div>
      <p className="muted">{t("reportRound.import.description")}</p>
      {!enabled ? (
        <div className="notice">
          <p>
            {terminology === "round"
              ? t("reportRound.import.proRound")
              : t("reportRound.import.proLegacy")}
          </p>
          <button className="button-quiet small-button" onClick={onUpgrade} type="button">
            {t("workspace.explorePro")}
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="portability-fields">
            <label className="field">
              <span>{t("reportRound.import.format")}</span>
              <select
                className="select"
                onChange={(event) => {
                  setFormat(event.target.value as ImportFormat);
                  setData("");
                  setValidation(null);
                  setMessage("");
                  setError("");
                  setErrorIsRaw(false);
                }}
                value={format}
              >
                <option value="openround_json">OpenRound JSON</option>
                <option value="csv">OpenRound CSV</option>
                <option value="bulk">{t("reportRound.import.bulkPaste")}</option>
                <option value="qti3">{t("reportRound.import.qtiPackage")}</option>
              </select>
            </label>
            <label className="field">
              <span>
                {terminology === "round"
                  ? t("reportRound.import.newRoundTitle")
                  : t("reportRound.import.newTitle")}
              </span>
              <input
                className="input"
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("reportRound.import.keepSourceTitle")}
                value={title}
              />
            </label>
            <label className="field">
              <span>
                {format === "qti3"
                  ? t("reportRound.import.chooseQti")
                  : t("reportRound.import.chooseTextFile")}
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
              {data ? t("reportRound.import.qtiReady") : t("reportRound.import.selectZip")}
            </p>
          ) : (
            <label className="field">
              <span>{t("reportRound.import.content")}</span>
              <textarea
                aria-describedby="import-format-help"
                className="textarea portability-source"
                maxLength={2_000_000}
                onChange={(event) => setData(event.target.value)}
                placeholder={
                  format === "bulk"
                    ? t("reportRound.import.bulkExample")
                    : t("reportRound.import.pasteContent", {
                        format: format === "csv" ? "CSV" : "JSON",
                      })
                }
                required
                value={data}
              />
            </label>
          )}
          <p className="muted" id="import-format-help">
            {format === "openround_json"
              ? terminology === "round"
                ? t("reportRound.import.jsonHelpRound")
                : t("reportRound.import.jsonHelpLegacy")
              : format === "csv"
                ? t("reportRound.import.csvHelp")
                : format === "bulk"
                  ? terminology === "round"
                    ? t("reportRound.import.bulkHelpRound")
                    : t("reportRound.import.bulkHelpLegacy")
                  : t("reportRound.import.qtiHelp")}
          </p>
          <button className="button" disabled={busy || !data.trim()} type="submit">
            {busy ? t("reportRound.import.validating") : t("reportRound.import.validate")}
          </button>
        </form>
      )}
      {error ? (
        <p className="error" lang={errorIsRaw ? "en-CA" : undefined} role="alert">
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
          <h3>{t("reportRound.import.validationDetails")}</h3>
          <ul>
            {[...validation.errors, ...validation.warnings].map((item, index) => (
              <li key={`${item.code}-${item.row ?? "set"}-${item.field ?? "content"}-${index}`}>
                <strong>
                  {item.severity === "error"
                    ? t("reportRound.import.error")
                    : t("reportRound.import.warning")}
                  :
                </strong>{" "}
                {item.row
                  ? `${t("reportRound.import.row", { row: formatNumber(locale, item.row) })}, `
                  : ""}
                {item.field ? <span lang="en-CA">{item.field}: </span> : null}
                <span lang="en-CA">{item.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
