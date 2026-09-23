"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "../../../components/brand";
import { apiFetch, humanError } from "../../../lib/api";

type Status = "checking" | "signed-out" | "ready" | "linking" | "error";

export default function LtiLinkPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [creatorSignedIn, setCreatorSignedIn] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fragmentToken = fragment.get("token");
    if (fragmentToken) {
      window.sessionStorage.setItem("openround_lti_link_token", fragmentToken);
      window.history.replaceState(null, "", window.location.pathname);
    }
    const savedToken = fragmentToken ?? window.sessionStorage.getItem("openround_lti_link_token");
    if (!savedToken) {
      setError("This LTI launch link is missing or has already been completed.");
      setStatus("error");
      return;
    }
    setToken(savedToken);
    apiFetch("/v1/auth/me")
      .then(() => {
        setCreatorSignedIn(true);
        setStatus("ready");
      })
      .catch((caught) => {
        setCreatorSignedIn(false);
        if ((caught as { status?: number }).status === 401) setStatus("signed-out");
        else {
          setError(humanError(caught));
          setStatus("error");
        }
      });
  }, []);

  async function linkIdentity() {
    if (!token) return;
    setStatus("linking");
    setError("");
    try {
      const result = await apiFetch<{ destination: string }>("/v1/lti/link", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      window.sessionStorage.removeItem("openround_lti_link_token");
      window.location.assign(result.destination);
    } catch (caught) {
      setError(humanError(caught));
      setStatus("error");
    }
  }

  return (
    <>
      <header className="shell topbar" lang="en-CA">
        <Brand href={creatorSignedIn ? "/home" : "/"} />
        <Link href={creatorSignedIn ? "/home" : "/"}>Home</Link>
      </header>
      <main className="shell auth-wrap" id="main" lang="en-CA">
        <section className="join-card auth-card" aria-labelledby="lti-link-title">
          <p className="eyebrow">Institution connection</p>
          <h1 id="lti-link-title">Link this LMS identity</h1>
          <p className="muted">
            OpenRound does not match LMS users by email. Sign in to your existing creator account,
            then explicitly link the issuer-scoped LMS identity that started this launch.
          </p>
          {status === "checking" ? <p className="muted">Checking your session…</p> : null}
          {status === "signed-out" ? (
            <Link className="button full-width" href="/signin?returnTo=%2Flti%2Flink">
              Sign in to continue
            </Link>
          ) : null}
          {status === "ready" || status === "linking" ? (
            <button
              className="button full-width"
              disabled={status === "linking"}
              onClick={() => void linkIdentity()}
              type="button"
            >
              {status === "linking" ? "Linking…" : "Link LMS identity and continue"}
            </button>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="notice">
            Linking is limited to the workspace configured for this LMS deployment and can be
            revoked later from Account.
          </p>
        </section>
      </main>
    </>
  );
}
