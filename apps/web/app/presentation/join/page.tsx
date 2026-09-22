"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import type { PublicFeatures } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { useLocale } from "../../../components/locale-provider";
import styles from "../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../lib/api";

function PresentationJoinForm() {
  const { t } = useLocale();
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
      <span className={styles.statusPill}>{t("delivery.join.eyebrow")}</span>
      <h1>{t("delivery.join.presentationTitle")}</h1>
      <p>{t("delivery.join.presentationDescription")}</p>
      {available === false ? (
        <p className="error" role="status">
          {t("delivery.join.presentationUnavailable")}
        </p>
      ) : null}
      <form className={styles.formStack} onSubmit={join}>
        <label>
          {t("delivery.join.codeLabel")}
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
          {t("delivery.join.nickname")}
          <input
            autoComplete="nickname"
            lang=""
            maxLength={32}
            onChange={(event) => setNickname(event.target.value)}
            placeholder={t("delivery.join.nicknamePlaceholder")}
            required
            value={nickname}
          />
        </label>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button full-width"
          disabled={available !== true || busy || code.length !== 7 || !nickname.trim()}
          type="submit"
        >
          {available === null
            ? t("delivery.common.loading")
            : busy
              ? t("delivery.join.joining")
              : t("delivery.join.presentationTitle")}
        </button>
      </form>
      <p>
        {t("live.presentationJoin.roundInsteadBefore")}{" "}
        <Link href="/join">{t("live.presentationJoin.roundInsteadLink")}</Link>.
      </p>
    </section>
  );
}

export default function PresentationJoinPage() {
  const { t } = useLocale();
  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Brand />
        <Link href="/" lang="en-CA">
          OpenRound
        </Link>
      </div>
      <Suspense
        fallback={<section className={styles.joinCard}>{t("delivery.common.loading")}</section>}
      >
        <PresentationJoinForm />
      </Suspense>
    </main>
  );
}
