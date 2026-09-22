"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Brand } from "../brand";
import { humanError } from "../../lib/api";
import { ColorModeMenu } from "./color-mode-menu";
import {
  useWorkspace,
  WorkspaceProvider,
  type WorkspaceProductFeatures,
} from "./workspace-provider";
import styles from "./workspace.module.css";

type IconName =
  | "home"
  | "library"
  | "sessions"
  | "assignments"
  | "results"
  | "discover"
  | "groups"
  | "workspace"
  | "search"
  | "plus"
  | "presentation"
  | "activity"
  | "help";

const destinations: Array<{
  href: string;
  icon: IconName;
  label: string;
  match: (path: string) => boolean;
  feature?: "discover" | "groups";
}> = [
  { href: "/home", icon: "home", label: "Home", match: (path) => path === "/home" },
  {
    href: "/library",
    icon: "library",
    label: "Library",
    match: (path) => path === "/library" || path === "/dashboard",
  },
  {
    href: "/sessions",
    icon: "sessions",
    label: "Sessions",
    match: (path) => path.startsWith("/sessions"),
  },
  {
    href: "/assignments",
    icon: "assignments",
    label: "Assignments",
    match: (path) => path.startsWith("/assignments") || path.includes("/assign"),
  },
  {
    href: "/results",
    icon: "results",
    label: "Results",
    match: (path) => path.startsWith("/results") || path.startsWith("/report/"),
  },
  {
    href: "/discover",
    icon: "discover",
    label: "Discover",
    match: (path) => path.startsWith("/discover") || path.startsWith("/templates"),
    feature: "discover",
  },
  {
    href: "/groups",
    icon: "groups",
    label: "Groups",
    match: (path) => path.startsWith("/groups"),
    feature: "groups",
  },
  {
    href: "/account",
    icon: "workspace",
    label: "Workspace",
    match: (path) => path.startsWith("/account"),
  },
];

function ShellIcon({ name }: { name: IconName }) {
  const common = {
    "aria-hidden": true,
    className: styles.icon,
    fill: "none",
    viewBox: "0 0 24 24",
  } as const;

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="m3 11 9-7 9 7" />
          <path d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" />
        </svg>
      );
    case "library":
      return (
        <svg {...common}>
          <rect height="14" rx="2" width="5" x="3" y="5" />
          <rect height="14" rx="2" width="5" x="10" y="5" />
          <path d="m17 6 3.5-1 3 13.5-3.5.8z" />
        </svg>
      );
    case "sessions":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
          <path d="M6 3.5 3.5 6M18 3.5 20.5 6" />
        </svg>
      );
    case "assignments":
      return (
        <svg {...common}>
          <rect height="16" rx="2" width="14" x="5" y="5" />
          <path d="M9 5V3h6v2M8.5 10h7M8.5 14h4" />
          <path d="m14.5 16 1.5 1.5 3-3" />
        </svg>
      );
    case "results":
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "discover":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" />
        </svg>
      );
    case "groups":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3" />
          <circle cx="17" cy="10" r="2.5" />
          <path d="M3.5 19c.5-3.3 2.3-5 5.5-5s5 1.7 5.5 5M15 15c2.8 0 4.5 1.3 5 4" />
        </svg>
      );
    case "workspace":
      return (
        <svg {...common}>
          <path d="M4 20V7l8-4 8 4v13" />
          <path d="M8 20v-5h8v5M8 9h1M12 9h1M16 9h1" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "presentation":
      return (
        <svg {...common}>
          <rect height="12" rx="2" width="18" x="3" y="4" />
          <path d="M12 16v4M8 20h8M7 12l3-3 2 2 3-3 2 2" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M4 13h4l2-6 4 11 2-5h4" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.4 2.4 0 0 1 4.6 1c0 2-2.4 2.2-2.4 4M12 18h.01" />
        </svg>
      );
  }
}

interface WorkspaceShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  requireBeta?: boolean;
  requiredFeature?: WorkspaceRolloutFeature;
  featureFallbackHref?: string;
}

export type WorkspaceRolloutFeature =
  "workspaceShell" | "builderV2" | "presentations" | "groups" | "discover";

export function WorkspaceNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const { productFeatures } = useWorkspace();
  return (
    <nav
      className={mobile ? styles.mobileNav : styles.nav}
      aria-label={mobile ? "Workspace sections" : "Workspace"}
    >
      {destinations
        .filter(
          (destination) => !destination.feature || productFeatures?.[destination.feature] === true,
        )
        .map((destination) => {
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
              {!mobile ? <ShellIcon name={destination.icon} /> : null}
              {destination.label}
            </Link>
          );
        })}
    </nav>
  );
}

function CreateMenu({ productFeatures }: { productFeatures: WorkspaceProductFeatures }) {
  return (
    <details className={styles.createMenu}>
      <summary className={styles.createButton}>
        <ShellIcon name="plus" />
        <span>Create</span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className={styles.createMenuPanel}>
        <p className={styles.createMenuLabel}>Create new</p>
        <Link
          className={styles.createMenuItem}
          href={productFeatures.builderV2 ? "/create" : "/dashboard"}
        >
          <span className={styles.createMenuIcon}>
            <ShellIcon name="assignments" />
          </span>
          <span>
            <strong>Round</strong>
            <small>Questions, diagnosis, rechecks, and practice</small>
          </span>
        </Link>
        {productFeatures.presentations ? (
          <Link className={styles.createMenuItem} href="/create/presentation">
            <span className={styles.createMenuIcon} data-tone="violet">
              <ShellIcon name="presentation" />
            </span>
            <span>
              <strong>Presentation</strong>
              <small>Turn slides or a source into an interactive session</small>
            </span>
          </Link>
        ) : null}
      </div>
    </details>
  );
}

export function WorkspaceShell({
  eyebrow = "Creator workspace",
  title,
  description,
  actions,
  children,
  requireBeta = true,
  requiredFeature,
  featureFallbackHref = "/dashboard",
}: WorkspaceShellProps) {
  const router = useRouter();
  const { creator, productFeatures, loading, error, canEdit, signOut, startUpgrade } =
    useWorkspace();
  const [actionError, setActionError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const workspaceAccessUnavailable =
    Boolean(error) ||
    (requireBeta &&
      (productFeatures?.workspaceShell !== true || productFeatures?.uxBeta !== true)) ||
    (requiredFeature !== undefined && productFeatures?.[requiredFeature] !== true);
  const shouldReturnToDashboard =
    !loading &&
    (creator !== null || productFeatures !== null || Boolean(error)) &&
    workspaceAccessUnavailable;

  useEffect(() => {
    if (shouldReturnToDashboard) {
      router.replace(featureFallbackHref);
    }
  }, [featureFallbackHref, router, shouldReturnToDashboard]);

  if (loading || workspaceAccessUnavailable) {
    return (
      <main className={styles.loading} id="main">
        <div className={styles.loadingMark} aria-hidden="true" />
        <p>Loading your workspace…</p>
      </main>
    );
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = globalSearch.trim();
    router.push(query ? `/library?q=${encodeURIComponent(query)}` : "/library");
  }

  const workspaceLabel = creator
    ? `${creator.segment === "workplace" ? "Workplace" : "Education"} workspace`
    : "Current workspace";
  const accountInitial = creator?.email?.trim().charAt(0).toUpperCase() || "O";

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
        <header className={styles.topHeader}>
          <div className={styles.mobileBrand}>
            <Brand />
          </div>
          <Link className={styles.workspaceSwitch} href="/account">
            <ShellIcon name="workspace" />
            <span>
              <small>Workspace</small>
              <strong>{workspaceLabel}</strong>
            </span>
          </Link>
          <form className={styles.globalSearch} onSubmit={submitSearch} role="search">
            <label className={styles.srOnly} htmlFor="workspace-search">
              Search your workspace library
            </label>
            <ShellIcon name="search" />
            <input
              autoComplete="off"
              id="workspace-search"
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search your library"
              type="search"
              value={globalSearch}
            />
          </form>
          <div className={styles.topActions}>
            {canEdit && productFeatures ? <CreateMenu productFeatures={productFeatures} /> : null}
            <ColorModeMenu />
            <Link className={styles.utilityAction} href="/activity" title="Activity inbox">
              <ShellIcon name="activity" />
              <span className={styles.utilityLabel}>Activity</span>
            </Link>
            <Link className={styles.utilityAction} href="/help" title="Help">
              <ShellIcon name="help" />
              <span className={styles.utilityLabel}>Help</span>
            </Link>
            <Link
              aria-label="Open account and workspace settings"
              className={styles.accountButton}
              href="/account"
              title={creator?.email}
            >
              {accountInitial}
            </Link>
          </div>
        </header>
        <WorkspaceNav mobile />
        <main className={styles.main} id="main">
          <header className={styles.pageHeader}>
            <div>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1>{title}</h1>
              {description ? <p className={styles.description}>{description}</p> : null}
            </div>
            <div className={styles.pageActions}>{actions}</div>
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

export function WorkspaceFeatureGate({
  feature,
  children,
  fallbackHref = "/dashboard",
}: {
  feature: WorkspaceRolloutFeature;
  children: ReactNode;
  fallbackHref?: string;
}) {
  const router = useRouter();
  const { productFeatures, loading, error } = useWorkspace();
  const resolved = productFeatures !== null || Boolean(error);
  const unavailable = resolved && (Boolean(error) || productFeatures?.[feature] !== true);

  useEffect(() => {
    if (!loading && resolved && unavailable) router.replace(fallbackHref);
  }, [fallbackHref, loading, resolved, router, unavailable]);

  if (loading || !resolved || unavailable) {
    return (
      <main className={styles.loading} id="main">
        <div className={styles.loadingMark} aria-hidden="true" />
        <p>Loading your workspace…</p>
      </main>
    );
  }

  return children;
}
