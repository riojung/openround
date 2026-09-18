"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Brand } from "../brand";
import { humanError } from "../../lib/api";
import { useWorkspace, WorkspaceProvider } from "./workspace-provider";
import styles from "./workspace.module.css";

const destinations = [
  { href: "/dashboard", label: "Rounds", match: (path: string) => path === "/dashboard" },
  { href: "/sessions", label: "Sessions", match: (path: string) => path.startsWith("/sessions") },
  { href: "/results", label: "Results", match: (path: string) => path.startsWith("/results") },
  {
    href: "/templates",
    label: "Templates",
    match: (path: string) => path.startsWith("/templates"),
  },
  { href: "/account", label: "Workspace", match: (path: string) => path.startsWith("/account") },
];

interface WorkspaceShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  requireBeta?: boolean;
}

export function WorkspaceNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      className={mobile ? styles.mobileNav : styles.nav}
      aria-label={mobile ? "Workspace sections" : "Workspace"}
    >
      {destinations.map((destination) => {
        const active = destination.match(pathname);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={
              mobile
                ? active
                  ? styles.mobileNavActive
                  : styles.mobileNavLink
                : active
                  ? styles.navLinkActive
                  : styles.navLink
            }
            href={destination.href}
            key={destination.href}
          >
            {!mobile ? <span className={styles.navDot} aria-hidden="true" /> : null}
            {destination.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkspaceShell({
  eyebrow = "Creator workspace",
  title,
  description,
  actions,
  children,
  requireBeta = true,
}: WorkspaceShellProps) {
  const router = useRouter();
  const { creator, productFeatures, loading, error, canEdit, signOut, startUpgrade } =
    useWorkspace();
  const [actionError, setActionError] = useState("");
  const shouldReturnToDashboard =
    requireBeta &&
    !loading &&
    (Boolean(error) ||
      ((creator !== null || productFeatures !== null) && productFeatures?.uxBeta !== true));
  const betaAccessUnavailable = requireBeta && (Boolean(error) || productFeatures?.uxBeta !== true);

  useEffect(() => {
    if (shouldReturnToDashboard) {
      router.replace("/dashboard");
    }
  }, [router, shouldReturnToDashboard]);

  if (loading || betaAccessUnavailable) {
    return (
      <main className={styles.loading} id="main">
        <div className={styles.loadingMark} aria-hidden="true" />
        <p>Loading your workspace…</p>
      </main>
    );
  }

  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#main">
        Skip to main content
      </a>
      <aside className={styles.sidebar}>
        <div className={styles.brandWrap}>
          <Brand />
        </div>
        <WorkspaceNav />
        <div className={styles.sidebarFooter}>
          <p className={styles.identity} title={creator?.email}>
            <strong>{creator?.email}</strong>
            <span>
              {creator?.role} · {creator?.plan} plan
            </span>
          </p>
          <div className={styles.accountActions}>
            {creator?.plan === "free" ? (
              <button
                className={styles.textButton}
                onClick={() => {
                  setActionError("");
                  void startUpgrade().catch((caught) => setActionError(humanError(caught)));
                }}
                type="button"
              >
                Explore Pro
              </button>
            ) : null}
            <button
              className={styles.textButton}
              onClick={() => {
                setActionError("");
                void signOut().catch((caught) => setActionError(humanError(caught)));
              }}
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className={styles.contentColumn}>
        <header className={styles.mobileHeader}>
          <Brand />
          {canEdit ? (
            <Link className="button small-button" href="/create">
              Create Round
            </Link>
          ) : null}
        </header>
        <WorkspaceNav mobile />
        <main className={styles.main} id="main">
          <header className={styles.pageHeader}>
            <div>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1>{title}</h1>
              {description ? <p className={styles.description}>{description}</p> : null}
            </div>
            <div
              className={`${styles.pageActions} ${!actions && canEdit ? styles.mobileDuplicateAction : ""}`}
            >
              {actions}
              {!actions && canEdit ? (
                <Link className="button" href="/create">
                  Create Round
                </Link>
              ) : null}
            </div>
          </header>
          {error || actionError ? (
            <p className="error" role="alert">
              {error || actionError}
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export function WorkspacePage(props: WorkspaceShellProps) {
  return (
    <WorkspaceProvider>
      <WorkspaceShell {...props} />
    </WorkspaceProvider>
  );
}
