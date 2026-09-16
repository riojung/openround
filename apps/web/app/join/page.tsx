"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import type { JoinResponse } from "@openround/contracts";
import { Brand } from "../../components/brand";
import { apiFetch, humanError } from "../../lib/api";

function JoinForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [code, setCode] = useState(() =>
    (searchParams.get("code") ?? "").replace(/\D/g, "").slice(0, 7),
  );
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const joined = await apiFetch<JoinResponse>("/v1/sessions/join", {
        method: "POST",
        body: JSON.stringify({ code, nickname: nickname || undefined }),
      });
      sessionStorage.setItem(
        `openround:participant:${joined.snapshot.sessionId}`,
        joined.participantToken,
      );
      sessionStorage.setItem("openround:last-code", code);
      router.push(`/play/${joined.snapshot.sessionId}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <section className="join-card auth-card" aria-labelledby="join-heading">
      <p className="eyebrow">Guest participation</p>
      <h1 id="join-heading" style={{ fontSize: "clamp(2.5rem, 9vw, 4.4rem)" }}>
        Join this round
      </h1>
      <p className="muted">Your nickname and answers belong only to this live session.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="join-code">Seven-digit round code</label>
          <input
            autoComplete="one-time-code"
            className="input code-input"
            id="join-code"
            inputMode="numeric"
            maxLength={7}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 7))}
            placeholder="0000000"
            required
            value={code}
          />
        </div>
        <div className="field">
          <label htmlFor="nickname">Nickname</label>
          <input
            autoComplete="nickname"
            className="input"
            id="nickname"
            maxLength={32}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="A name for this round"
            value={nickname}
          />
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button full-width" disabled={busy || code.length !== 7} type="submit">
          {busy ? "Joining…" : "Join round"}
        </button>
      </form>
      <p className="muted" style={{ fontSize: "0.84rem", marginTop: 18, marginBottom: 0 }}>
        By joining, you agree to the session rules and <Link href="/privacy">privacy notice</Link>.
      </p>
    </section>
  );
}

export default function JoinPage() {
  return (
    <>
      <header className="shell topbar">
        <Brand />
      </header>
      <main className="shell auth-wrap">
        <Suspense fallback={<div className="panel">Preparing the join form…</div>}>
          <JoinForm />
        </Suspense>
      </main>
    </>
  );
}
