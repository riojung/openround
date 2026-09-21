"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import type { PublicFeatures } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import styles from "../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../lib/api";

function PresentationJoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(() =>
    (searchParams.get("code") ?? "").replace(/\D/g, "").slice(0, 7),
  );
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch<PublicFeatures>("/v1/features")
      .then((features) => {
        if (active) setAvailable(features.presentations);
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch<{
        participantToken: string;
        snapshot: { id: string };
      }>("/v1/presentation-sessions/join", {
        method: "POST",
        body: JSON.stringify({ code, nickname }),
      });
      sessionStorage.setItem(
        `openround:presentation-participant:${response.snapshot.id}`,
        response.participantToken,
      );
      router.push(`/presentation-session/${response.snapshot.id}/play`);
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <section className={styles.joinCard}>
      <span className={styles.statusPill}>Guest participation</span>
      <h1>Join a Presentation</h1>
      <p>
        No workspace account is needed. Your nickname and responses belong only to this session.
      </p>
      {available === false ? (
        <p className="error" role="status">
          Presentation rooms are not available right now. You can still join an active Round.
        </p>
      ) : null}
      <form className={styles.formStack} onSubmit={join}>
        <label>
          Seven-digit code
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={7}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 7))}
            placeholder="0000000"
            required
            value={code}
          />
        </label>
        <label>
          Nickname
          <input
            autoComplete="nickname"
            maxLength={32}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="How the facilitator will see you"
            required
            value={nickname}
          />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button full-width"
          disabled={available !== true || busy || code.length !== 7 || !nickname.trim()}
          type="submit"
        >
          {available === null ? "Checking availability…" : busy ? "Joining…" : "Join Presentation"}
        </button>
      </form>
      <p>
        Joining a Round instead? <Link href="/join">Use the Round join page</Link>.
      </p>
    </section>
  );
}

export default function PresentationJoinPage() {
  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Brand />
        <Link href="/">OpenRound</Link>
      </div>
      <Suspense fallback={<section className={styles.joinCard}>Loading join form…</section>}>
        <PresentationJoinForm />
      </Suspense>
    </main>
  );
}
