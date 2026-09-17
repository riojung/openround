"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Brand } from "./brand";
import { apiFetch, humanError } from "../lib/api";

interface CreatorSummary {
  email: string;
}

type SessionState =
  | { status: "checking"; creator: null }
  | { status: "signed-out"; creator: null }
  | { status: "signed-in"; creator: CreatorSummary };

export function SiteHeader() {
  const [session, setSession] = useState<SessionState>({ status: "checking", creator: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const mobileMenuId = useId();

  useEffect(() => {
    let active = true;
    apiFetch<{ creator: CreatorSummary }>("/v1/auth/me")
      .then(({ creator }) => {
        if (active) setSession({ status: "signed-in", creator });
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

  return (
    <header className="shell topbar site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Brand />
      <nav
        aria-busy={session.status === "checking"}
        aria-label="Primary navigation"
        className="nav-links site-desktop-nav"
      >
        {signedIn ? (
          <>
            <span className="creator-identity" title={session.creator.email}>
              {session.creator.email}
            </span>
            <Link href="/dashboard">My quizzes</Link>
            <Link href="/account">Account</Link>
            <button
              className="nav-text-button"
              disabled={signingOut}
              onClick={() => void signOut()}
              type="button"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            {signOutError ? (
              <span className="site-nav-error" role="alert">
                {signOutError}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/signin">Sign in</Link>
          </>
        )}
        <Link className="button small-button" href="/join">
          Join a round
        </Link>
      </nav>
      <div className="site-mobile-actions">
        <Link className="button small-button" href={signedIn ? "/dashboard" : "/signin"}>
          {signedIn ? "My quizzes" : "Sign in"}
        </Link>
        <button
          aria-controls={mobileMenuId}
          aria-expanded={menuOpen}
          className="button-quiet small-button"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>
      <nav
        aria-busy={session.status === "checking"}
        aria-label="Mobile navigation"
        className="site-mobile-nav"
        hidden={!menuOpen}
        id={mobileMenuId}
      >
        {signedIn ? (
          <>
            <div className="site-mobile-session">
              <span>Signed in as</span>
              <strong>{session.creator.email}</strong>
            </div>
            <Link href="/dashboard">My quizzes</Link>
            <Link href="/account">Account</Link>
            <Link href="/pricing">Plans</Link>
            <button disabled={signingOut} onClick={() => void signOut()} type="button">
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </>
        ) : (
          <>
            <Link className="site-mobile-primary" href="/signin">
              Sign in to create and manage quizzes
            </Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
          </>
        )}
        <Link href="/join">Join a round</Link>
        {signOutError ? (
          <p className="site-nav-error" role="alert">
            {signOutError}
          </p>
        ) : null}
      </nav>
    </header>
  );
}
