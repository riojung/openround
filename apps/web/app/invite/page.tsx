"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "../../components/brand";
import { apiFetch, humanError } from "../../lib/api";

export default function WorkspaceInvitationPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!token || !acceptPolicies) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/v1/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, acceptPolicies }),
      });
      router.replace("/dashboard?invitation=accepted");
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link href="/">Home</Link>
      </header>
      <main className="shell auth-wrap">
        <section className="join-card auth-card" aria-labelledby="invite-title">
          <p className="eyebrow">Workspace invitation</p>
          <h1 id="invite-title" style={{ fontSize: "clamp(2.4rem, 8vw, 4rem)" }}>
            Join the team
          </h1>
          <p className="muted">
            Accepting gives you the role chosen by the workspace owner. You can still use
            participant mode without an account.
          </p>
          {!token ? (
            <p className="error" role="alert">
              This invitation link is incomplete. Ask the workspace owner to send a new one.
            </p>
          ) : (
            <form onSubmit={(event) => void accept(event)}>
              <label className="checkbox-field policy-consent">
                <input
                  checked={acceptPolicies}
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
              <button
                className="button full-width"
                disabled={!acceptPolicies || busy}
                type="submit"
              >
                {busy ? "Joining…" : "Accept invitation"}
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}
