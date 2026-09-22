"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";

export function JoinCodeForm({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  const [code, setCode] = useState("");
  const router = useRouter();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (/^\d{7}$/.test(code)) router.push(`/join?code=${code}`);
  }

  return (
    <form onSubmit={submit} aria-label={t("delivery.join.formLabel")}>
      <div className="field">
        <label htmlFor={compact ? "home-code" : "join-code"}>{t("delivery.join.codeLabel")}</label>
        <input
          autoComplete="one-time-code"
          className="input code-input"
          id={compact ? "home-code" : "join-code"}
          inputMode="numeric"
          maxLength={7}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 7))}
          placeholder="0000000"
          required
          value={code}
        />
      </div>
      <button className="button full-width" disabled={code.length !== 7} type="submit">
        {t("delivery.common.continue")}
      </button>
    </form>
  );
}
