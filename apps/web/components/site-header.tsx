"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Brand, creatorLandingHref } from "./brand";
import { apiFetch, humanError } from "../lib/api";
import { useLocale } from "./locale-provider";

interface CreatorSummary {
  email: string;
}

type SessionState =
  | { status: "checking"; creator: null }
  | { status: "signed-out"; creator: null }
  | {
      status: "signed-in";
      creator: CreatorSummary;
      productFeatures: { workspaceShell: boolean } | null;
    };

export function SiteHeader() {
  const { t } = useLocale();
  const [session, setSession] = useState<SessionState>({ status: "checking", creator: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const mobileMenuId = useId();

  useEffect(() => {
    let active = true;
    apiFetch<{
      creator: CreatorSummary;
      productFeatures?: { workspaceShell?: boolean };
    }>("/v1/auth/me")
      .then(({ creator, productFeatures }) => {
        if (active) {
          setSession({
            status: "signed-in",
            creator,
            productFeatures: {
              workspaceShell: productFeatures?.workspaceShell === true,
            },
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if ((error as { status?: number }).status === 401) {
          setSession({ status: "signed-out", creator: null });
          return;
        }
        setSession({ status: "signed-out", creator: null });
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await apiFetch("/v1/auth/logout", { method: "POST", body: "{}" });
      window.location.assign("/");
    } catch (error) {
      setSignOutError(humanError(error));
      setSigningOut(false);
    }
  }

  const signedIn = session.status === "signed-in";
  const brandHref = signedIn ? creatorLandingHref(session.productFeatures) : "/";

  return (
    <header className="shell topbar site-header">
      <a className="skip-link" href="#main">
        {t("delivery.site.skip")}
      </a>
      <Brand href={brandHref} />
      <nav
        aria-busy={session.status === "checking"}
        aria-label={t("delivery.site.primaryNavigation")}
        className="nav-links site-desktop-nav"
      >
        {signedIn ? (
          <>
            <span className="creator-identity" title={session.creator.email}>
              {session.creator.email}
            </span>
            <Link href="/dashboard">{t("delivery.site.myRounds")}</Link>
            <Link href="/account">{t("delivery.site.account")}</Link>
            <button
              className="nav-text-button"
              disabled={signingOut}
              onClick={() => void signOut()}
              type="button"
            >
              {signingOut ? t("delivery.site.signingOut") : t("delivery.site.signOut")}
            </button>
            {signOutError ? (
              <span className="site-nav-error" role="alert">
                {signOutError}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <Link href="/pricing">{t("delivery.site.pricing")}</Link>
            <Link href="/privacy">{t("delivery.site.privacy")}</Link>
            <Link href="/signin">{t("delivery.site.signIn")}</Link>
          </>
        )}
        <Link className="button small-button" href="/join">
          {t("delivery.site.joinRound")}
        </Link>
      </nav>
      <div className="site-mobile-actions">
        <Link className="button small-button" href={signedIn ? "/dashboard" : "/signin"}>
          {signedIn ? t("delivery.site.myLibrary") : t("delivery.site.signIn")}
        </Link>
        <button
          aria-controls={mobileMenuId}
          aria-expanded={menuOpen}
          className="button-quiet small-button"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          {menuOpen ? t("delivery.site.close") : t("delivery.site.menu")}
        </button>
      </div>
      <nav
        aria-busy={session.status === "checking"}
        aria-label={t("delivery.site.mobileNavigation")}
        className="site-mobile-nav"
        hidden={!menuOpen}
        id={mobileMenuId}
      >
        {signedIn ? (
          <>
            <div className="site-mobile-session">
              <span>{t("delivery.site.signedInAs")}</span>
              <strong>{session.creator.email}</strong>
            </div>
            <Link href="/dashboard">{t("delivery.site.myRounds")}</Link>
            <Link href="/account">{t("delivery.site.account")}</Link>
            <Link href="/pricing">{t("delivery.site.plans")}</Link>
            <button disabled={signingOut} onClick={() => void signOut()} type="button">
              {signingOut ? t("delivery.site.signingOut") : t("delivery.site.signOut")}
            </button>
          </>
        ) : (
          <>
            <Link className="site-mobile-primary" href="/signin">
              {t("delivery.site.signInToCreate")}
            </Link>
            <Link href="/pricing">{t("delivery.site.pricing")}</Link>
            <Link href="/privacy">{t("delivery.site.privacy")}</Link>
          </>
        )}
        <Link href="/join">{t("delivery.site.joinRound")}</Link>
        {signOutError ? (
          <p className="site-nav-error" role="alert">
            {signOutError}
          </p>
        ) : null}
      </nav>
    </header>
  );
}
