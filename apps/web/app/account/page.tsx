"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { BrandTheme, Entitlements } from "@openround/contracts";
import { Brand } from "../../components/brand";
import { apiFetch, humanError } from "../../lib/api";
import { liveThemeStyle } from "../../lib/theme";

interface Creator {
  email: string;
  segment: "education" | "workplace";
  plan: "free" | "pro" | "team";
}

const defaultTheme: BrandTheme = {
  organizationName: "My organization",
  primaryColor: "#0B2239",
  accentColor: "#087375",
};

export default function AccountPage() {
  const router = useRouter();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [theme, setTheme] = useState<BrandTheme>(defaultTheme);
  const [savedTheme, setSavedTheme] = useState<BrandTheme | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"" | "billing" | "export" | "theme" | "delete">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch<{ creator: Creator; entitlements: Entitlements }>("/v1/auth/me"),
      apiFetch<{ theme: BrandTheme | null; enabled: boolean }>("/v1/account/theme"),
    ])
      .then(([account, branding]) => {
        setCreator(account.creator);
        setEntitlements(account.entitlements);
        setSavedTheme(branding.theme);
        setTheme(branding.theme ?? defaultTheme);
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [router]);

  async function saveTheme(event: FormEvent) {
    event.preventDefault();
    if (!entitlements?.brandTheme) return;
    setBusy("theme");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ theme: BrandTheme }>("/v1/account/theme", {
        method: "PUT",
        body: JSON.stringify(theme),
      });
      setTheme(response.theme);
      setSavedTheme(response.theme);
      setMessage("Your brand theme was saved for new live sessions.");
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function resetTheme() {
    if (!savedTheme) return;
    setBusy("theme");
    setError("");
    setMessage("");
    try {
      await apiFetch("/v1/account/theme", { method: "DELETE" });
      setSavedTheme(null);
      setTheme(defaultTheme);
      setMessage("The workspace theme was removed. New sessions will use OpenRound styling.");
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function downloadExport() {
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<Record<string, unknown>>("/v1/account/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "openround-account-export.json";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage("Your account export was downloaded.");
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function openBillingPortal() {
    setBusy("billing");
    setError("");
    try {
      const result = await apiFetch<{ url: string }>("/v1/billing/portal", {
        method: "POST",
        body: "{}",
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(humanError(caught));
      setBusy("");
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== "DELETE") return;
    setBusy("delete");
    setError("");
    try {
      await apiFetch("/v1/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      router.replace("/");
    } catch (caught) {
      setError(humanError(caught));
      setBusy("");
    }
  }

  const effectivePlan = entitlements?.plan ?? creator?.plan;

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <Link className="button-quiet small-button" href="/dashboard">
          Dashboard
        </Link>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Account and data</p>
            <h1>Manage your account</h1>
            <p className="muted">
              {creator
                ? `${creator.email} · ${creator.segment} · ${effectivePlan} plan`
                : "Loading account…"}
            </p>
          </div>
        </div>
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
        <div className="settings-grid">
          <section className="panel">
            <p className="eyebrow">Subscription</p>
            <h2 style={{ fontSize: "1.8rem" }}>
              {creator ? `${effectivePlan} plan` : "Loading plan…"}
            </h2>
            <p className="muted">
              Hosted billing is disabled in community deployments. Hosted Pro customers manage
              payment details and cancellation through the secure billing portal.
            </p>
            {entitlements ? (
              <p className="muted">
                Up to {entitlements.maxParticipants} live participants ·{" "}
                {entitlements.maxPublishedQuizzes === null
                  ? "unlimited published quizzes"
                  : `${entitlements.maxPublishedQuizzes} published quizzes`}
                {" · "}
                {entitlements.reportRetentionDays}-day report retention · CSV{" "}
                {entitlements.csvExport ? "included" : "requires Pro"}
              </p>
            ) : null}
            {effectivePlan === "pro" ? (
              <button
                className="button-quiet"
                disabled={busy !== ""}
                onClick={() => void openBillingPortal()}
                type="button"
              >
                {busy === "billing" ? "Opening portal…" : "Manage billing"}
              </button>
            ) : effectivePlan === "free" ? (
              <Link className="button-quiet" href="/pricing">
                Compare plans
              </Link>
            ) : (
              <p className="muted">Limits are controlled by your community operator.</p>
            )}
          </section>
          <section className="panel">
            <p className="eyebrow">Live-session brand</p>
            <h2 style={{ fontSize: "1.8rem" }}>Workspace theme</h2>
            <p className="muted">
              One contrast-checked theme is copied into each new session so its participant and
              presenter views stay consistent throughout the round.
            </p>
            {entitlements && !entitlements.brandTheme ? (
              <p className="notice">
                Editing and applying a workspace theme requires hosted Pro. Community deployments
                include it without an application license fee.
              </p>
            ) : null}
            <div
              className="live-shell theme-preview"
              data-branded="true"
              style={liveThemeStyle(theme)}
            >
              <Brand inverted name={theme.organizationName || "My organization"} />
              <p className="theme-preview-copy">Participant and presenter preview</p>
            </div>
            <form onSubmit={saveTheme}>
              <label className="field" htmlFor="theme-name">
                <span>Organization name</span>
                <input
                  className="input"
                  disabled={!entitlements?.brandTheme || busy !== ""}
                  id="theme-name"
                  maxLength={80}
                  onChange={(event) => setTheme({ ...theme, organizationName: event.target.value })}
                  required
                  value={theme.organizationName}
                />
              </label>
              <div className="settings-grid">
                <label className="field" htmlFor="theme-primary">
                  <span>Background colour · {theme.primaryColor}</span>
                  <input
                    className="color-input"
                    disabled={!entitlements?.brandTheme || busy !== ""}
                    id="theme-primary"
                    onChange={(event) => setTheme({ ...theme, primaryColor: event.target.value })}
                    type="color"
                    value={theme.primaryColor}
                  />
                </label>
                <label className="field" htmlFor="theme-accent">
                  <span>Action colour · {theme.accentColor}</span>
                  <input
                    className="color-input"
                    disabled={!entitlements?.brandTheme || busy !== ""}
                    id="theme-accent"
                    onChange={(event) => setTheme({ ...theme, accentColor: event.target.value })}
                    type="color"
                    value={theme.accentColor}
                  />
                </label>
              </div>
              <p className="muted">
                Both colours must maintain at least 4.5:1 contrast with white text. Changes apply to
                sessions created after saving, not rooms already in progress.
              </p>
              <div className="button-row">
                <button
                  className="button"
                  disabled={!entitlements?.brandTheme || busy !== ""}
                  type="submit"
                >
                  {busy === "theme" ? "Saving…" : "Save theme"}
                </button>
                {savedTheme ? (
                  <button
                    className="button-quiet"
                    disabled={busy !== ""}
                    onClick={() => void resetTheme()}
                    type="button"
                  >
                    Use OpenRound theme
                  </button>
                ) : null}
              </div>
            </form>
          </section>
          <section className="panel">
            <p className="eyebrow">Portable data</p>
            <h2 style={{ fontSize: "1.8rem" }}>Export your account</h2>
            <p className="muted">
              Download your profile, workspace, quiz versions, media metadata, live-session data,
              reports, billing state, consent, and audit records as UTF-8 JSON. Secret token hashes
              are excluded.
            </p>
            <button
              className="button-quiet"
              disabled={!creator || busy !== ""}
              onClick={() => void downloadExport()}
              type="button"
            >
              {busy === "export" ? "Preparing export…" : "Download account export"}
            </button>
          </section>
          <section className="panel danger-panel">
            <p className="eyebrow">Permanent action</p>
            <h2 style={{ fontSize: "1.8rem" }}>Delete your account</h2>
            <p className="muted">
              This removes owned workspaces, quizzes, private image objects, sessions, answers,
              reports, and cached live state, revokes your sign-in sessions, and anonymizes your
              email. This cannot be undone.
            </p>
            <form onSubmit={deleteAccount}>
              <label className="field" htmlFor="delete-confirmation">
                <span>
                  Type <strong>DELETE</strong> to confirm
                </span>
                <input
                  autoComplete="off"
                  className="input"
                  id="delete-confirmation"
                  onChange={(event) => setConfirmation(event.target.value)}
                  value={confirmation}
                />
              </label>
              <button
                className="button-danger"
                disabled={!creator || confirmation !== "DELETE" || busy !== ""}
                type="submit"
              >
                {busy === "delete" ? "Deleting account…" : "Delete account"}
              </button>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
