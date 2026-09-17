"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "../../components/brand";
import { apiFetch, humanError } from "../../lib/api";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [segment, setSegment] = useState<"education" | "workplace">("workplace");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [debugUrl, setDebugUrl] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [acceptPolicies, setAcceptPolicies] = useState(false);

  useEffect(() => setHydrated(true), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const result = await apiFetch<{ accepted: boolean; debugUrl?: string }>(
        "/v1/auth/magic-link",
        {
          method: "POST",
          body: JSON.stringify({ email, segment, acceptPolicies }),
        },
      );
      setDebugUrl(result.debugUrl ?? "");
      setStatus("sent");
    } catch (caught) {
      setError(humanError(caught));
      setStatus("idle");
    }
  }

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link href="/join">Join a round</Link>
      </header>
      <main className="shell auth-wrap">
        <section className="join-card auth-card" aria-labelledby="signin-title">
          <p className="eyebrow">Creator access</p>
          <h1 id="signin-title" style={{ fontSize: "clamp(2.4rem, 8vw, 4rem)" }}>
            Sign in by email
          </h1>
          <p className="muted">
            We will send a single-use link. No password or memory puzzle required.
          </p>
          <form onSubmit={submit}>
            <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="field-label" style={{ marginBottom: 8 }}>
                I mainly facilitate
              </legend>
              <div className="segmented">
                <button
                  aria-pressed={segment === "workplace"}
                  disabled={!hydrated}
                  onClick={() => setSegment("workplace")}
                  type="button"
                >
                  Workplace learning
                </button>
                <button
                  aria-pressed={segment === "education"}
                  disabled={!hydrated}
                  onClick={() => setSegment("education")}
                  type="button"
                >
                  Education
                </button>
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                autoComplete="email"
                className="input"
                disabled={!hydrated}
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <label className="checkbox-field policy-consent">
              <input
                checked={acceptPolicies}
                disabled={!hydrated}
                onChange={(event) => setAcceptPolicies(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                I accept the <Link href="/terms">Terms</Link> and acknowledge the{" "}
                <Link href="/privacy">Privacy notice</Link>.
              </span>
            </label>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            {status === "sent" ? (
              <div className="success" role="status">
                {debugUrl ? (
                  <div style={{ marginTop: 10 }}>
                    Your local sign-in link is ready. <a href={debugUrl}>Continue to dashboard</a>.
                  </div>
                ) : (
                  "Check your inbox for the sign-in link."
                )}
              </div>
            ) : null}
            <button
              className="button full-width"
              disabled={!hydrated || !acceptPolicies || status === "sending"}
              type="submit"
            >
              {status === "sending" ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
