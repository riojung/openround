"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { recordPracticeAssignmentShared } from "../workspace/product-events";
import { practiceLinksCsv, type CreatedPractice } from "../../lib/practice-assignment";
import styles from "./practice.module.css";

export function PracticeLinkReceipt({ created }: { created: CreatedPractice }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => heading.current?.focus(), []);

  async function copy(url: string, label: string) {
    setError("");
    setStatus("");
    try {
      await navigator.clipboard.writeText(url);
      recordPracticeAssignmentShared();
      setStatus(`${label} copied.`);
    } catch {
      setError("Copy was blocked. Select and copy the link instead.");
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([practiceLinksCsv(created)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `openround-practice-${created.followup.id}-links.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    recordPracticeAssignmentShared();
    setStatus("Private practice links downloaded.");
  }

  return (
    <section className={styles.receipt} aria-labelledby="pack-practice-receipt-heading">
      <p className="eyebrow">Practice assignment created</p>
      <h2 id="pack-practice-receipt-heading" ref={heading} tabIndex={-1}>
        Save your private links
      </h2>
      <p>
        {created.followup.recoveryPackSource?.role === "full_sequence"
          ? "This assignment contains the frozen diagnostic, intervention cards, and linked recheck, not the optional delayed probe or a delayed recovery trail."
          : "This assignment contains one frozen delayed probe, not the full Recovery Pack or a delayed recovery trail."}{" "}
        Existing assignments do not change when the source Pack changes or is deleted.
      </p>
      <p>
        Save or download these links now. OpenRound stores only token hashes; these exact links are
        not displayed again in practice management. Keep them private.
      </p>
      <div className={styles.linkBox}>
        <div className={styles.linkRow}>
          <label className="field" htmlFor="pack-practice-generic-link">
            <span>Generic anonymous practice link</span>
            <input
              className="input"
              id="pack-practice-generic-link"
              readOnly
              value={created.genericUrl}
            />
          </label>
          <button
            className="button-quiet"
            onClick={() => void copy(created.genericUrl, "Generic link")}
            type="button"
          >
            Copy
          </button>
        </div>
        {created.personalAccess.length ? <h3>One-attempt personal links</h3> : null}
        <ul className={styles.personalLinks}>
          {created.personalAccess.map((access) => (
            <li className={styles.linkRow} key={access.id}>
              <label className="field" htmlFor={`pack-practice-link-${access.id}`}>
                <span>{access.nickname ?? access.label}</span>
                <input
                  className="input"
                  id={`pack-practice-link-${access.id}`}
                  readOnly
                  value={access.url ?? ""}
                />
              </label>
              <button
                className="button-quiet"
                disabled={!access.url}
                onClick={() => access.url && void copy(access.url, access.nickname ?? access.label)}
                type="button"
              >
                Copy
              </button>
            </li>
          ))}
        </ul>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className={status ? "success" : "sr-only"} role="status">
        {status}
      </p>
      <div className={styles.receiptActions}>
        <button className="button" onClick={download} type="button">
          Download links CSV
        </button>
        <Link className="button-quiet" href={`/practice/${created.followup.id}`}>
          Manage practice
        </Link>
        <Link className="button-quiet" href="/recovery-packs">
          Done
        </Link>
      </div>
    </section>
  );
}
