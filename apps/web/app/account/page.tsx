"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type {
  BrandTheme,
  Entitlements,
  FederatedIdentity,
  LtiRegistration,
  OidcStatus,
  WorkspaceInstitutionPolicy,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceSummary,
} from "@openround/contracts";
import { Brand } from "../../components/brand";
import { WorkspaceProvider } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../lib/api";
import { liveThemeStyle } from "../../lib/theme";
import styles from "./account.module.css";

interface Creator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  role: "owner" | "editor" | "viewer";
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
  const [busy, setBusy] = useState<
    "" | "audit" | "billing" | "export" | "theme" | "embed" | "federation" | "delete"
  >("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  const [collaborationBusy, setCollaborationBusy] = useState("");
  const [embedOrigins, setEmbedOrigins] = useState("");
  const [institutionPolicy, setInstitutionPolicy] = useState<WorkspaceInstitutionPolicy | null>(
    null,
  );
  const [oidcStatus, setOidcStatus] = useState<OidcStatus | null>(null);
  const [federatedIdentities, setFederatedIdentities] = useState<FederatedIdentity[]>([]);
  const [ltiRegistrations, setLtiRegistrations] = useState<LtiRegistration[]>([]);
  const [uxBeta, setUxBeta] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{
        creator: Creator;
        entitlements: Entitlements;
        productFeatures?: { uxBeta?: boolean };
      }>("/v1/auth/me"),
      apiFetch<{ theme: BrandTheme | null; enabled: boolean }>("/v1/account/theme"),
      apiFetch<{ activeWorkspaceId: string; workspaces: WorkspaceSummary[] }>("/v1/workspaces"),
      apiFetch<{ origins: string[] }>("/v1/account/embed-origins"),
      apiFetch<WorkspaceInstitutionPolicy>("/v1/workspace/institution-policy"),
      apiFetch<{ identities: FederatedIdentity[] }>("/v1/auth/federated-identities"),
    ])
      .then(async ([account, branding, workspaceList, embedPolicy, policy, identities]) => {
        setCreator(account.creator);
        setEntitlements(account.entitlements);
        setUxBeta(Boolean(account.productFeatures?.uxBeta));
        setSavedTheme(branding.theme);
        setTheme(branding.theme ?? defaultTheme);
        setWorkspaces(workspaceList.workspaces);
        setEmbedOrigins(embedPolicy.origins.join("\n"));
        setInstitutionPolicy(policy);
        setFederatedIdentities(identities.identities);
        setOidcStatus(
          await apiFetch<OidcStatus>(
            `/v1/auth/oidc/status?workspaceId=${encodeURIComponent(account.creator.workspaceId)}`,
          ),
        );
        if (account.creator.role === "owner") {
          const [collaboration, lti] = await Promise.all([
            apiFetch<{
              members: WorkspaceMember[];
              invitations: WorkspaceInvitation[];
            }>("/v1/workspace/members"),
            apiFetch<{ registrations: LtiRegistration[] }>("/v1/workspace/lti-registrations"),
          ]);
          setMembers(collaboration.members);
          setInvitations(collaboration.invitations);
          setLtiRegistrations(lti.registrations);
        }
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [router]);

  async function refreshCollaboration() {
    const collaboration = await apiFetch<{
      members: WorkspaceMember[];
      invitations: WorkspaceInvitation[];
    }>("/v1/workspace/members");
    setMembers(collaboration.members);
    setInvitations(collaboration.invitations);
  }

  async function switchWorkspace(workspaceId: string) {
    if (!creator || workspaceId === creator.workspaceId) return;
    setCollaborationBusy("switch");
    setError("");
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/select`, { method: "POST", body: "{}" });
      window.location.reload();
    } catch (caught) {
      setError(humanError(caught));
      setCollaborationBusy("");
    }
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();
    setCollaborationBusy("invite");
    setError("");
    setMessage("");
    setInviteUrl("");
    try {
      const result = await apiFetch<{ invitation: WorkspaceInvitation; debugUrl?: string }>(
        "/v1/workspace/invitations",
        {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        },
      );
      setInviteEmail("");
      setInviteUrl(result.debugUrl ?? "");
      setMessage(`Invitation sent to ${result.invitation.email}.`);
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

  async function updateMemberRole(userId: string, role: "editor" | "viewer") {
    setCollaborationBusy(`member:${userId}`);
    setError("");
    try {
      await apiFetch(`/v1/workspace/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm("Remove this member from the workspace?")) return;
    setCollaborationBusy(`member:${userId}`);
    setError("");
    try {
      await apiFetch(`/v1/workspace/members/${userId}`, { method: "DELETE" });
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

  async function revokeInvitation(invitationId: string) {
    setCollaborationBusy(`invitation:${invitationId}`);
    setError("");
    try {
      await apiFetch(`/v1/workspace/invitations/${invitationId}`, { method: "DELETE" });
      await refreshCollaboration();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setCollaborationBusy("");
    }
  }

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

  async function saveEmbedOrigins(event: FormEvent) {
    event.preventDefault();
    if (creator?.role !== "owner") return;
    setBusy("embed");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch<{ origins: string[] }>("/v1/account/embed-origins", {
        method: "PUT",
        body: JSON.stringify({
          origins: embedOrigins
            .split("\n")
            .map((origin) => origin.trim())
            .filter(Boolean),
        }),
      });
      setEmbedOrigins(response.origins.join("\n"));
      setMessage("Secure presenter embed origins were saved.");
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function linkInstitutionIdentity() {
    if (!creator) return;
    setBusy("federation");
    setError("");
    try {
      const result = await apiFetch<{ authorizationUrl: string }>("/v1/auth/oidc/start", {
        method: "POST",
        body: JSON.stringify({ workspaceId: creator.workspaceId, mode: "link" }),
      });
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(humanError(caught));
      setBusy("");
    }
  }

  async function unlinkInstitutionIdentity(identityId: string) {
    if (!window.confirm("Remove this institution sign-in method?")) return;
    setBusy("federation");
    setError("");
    try {
      await apiFetch(`/v1/auth/federated-identities/${identityId}`, { method: "DELETE" });
      setFederatedIdentities((identities) =>
        identities.filter((identity) => identity.id !== identityId),
      );
      setMessage("Institution sign-in was removed. Email sign-in remains available.");
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

  async function downloadAuditExport() {
    setBusy("audit");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<Record<string, unknown>>("/v1/workspace/audit-export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `openround-audit-${creator?.workspaceId ?? "workspace"}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage("The versioned institution audit export was downloaded.");
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

  const content = (
    <div className={uxBeta ? styles.account : undefined}>
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
          <p className="eyebrow">Workspace</p>
          <h2 style={{ fontSize: "1.8rem" }}>Active workspace</h2>
          <p className="muted">
            Your role is <strong>{creator?.role ?? "loading"}</strong>. Content, sessions, reports,
            and billing are isolated to the selected workspace.
          </p>
          <p className="notice">
            Home region:{" "}
            <strong>
              {workspaces.find((workspace) => workspace.id === creator?.workspaceId)?.homeRegion ??
                "loading"}
            </strong>
            . Existing workspaces are never moved automatically.
          </p>
          <label className="field" htmlFor="active-workspace">
            <span>Workspace</span>
            <select
              className="select"
              disabled={!creator || collaborationBusy === "switch" || workspaces.length < 2}
              id="active-workspace"
              onChange={(event) => void switchWorkspace(event.target.value)}
              value={creator?.workspaceId ?? ""}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} · {workspace.role}
                </option>
              ))}
            </select>
          </label>
        </section>
        <section className="panel">
          <p className="eyebrow">Institution access</p>
          <h2 style={{ fontSize: "1.8rem" }}>Identity and integration policy</h2>
          <p className="muted">
            Anonymous guest participation remains the default. Institution identity, roster, and
            grade services require an approved contract and an operator-granted policy.
          </p>
          {institutionPolicy ? (
            <dl className="definition-list compact-definition-list">
              <div>
                <dt>Contract</dt>
                <dd>{institutionPolicy.contractStatus}</dd>
              </div>
              <div>
                <dt>Participant identity</dt>
                <dd>{institutionPolicy.identityRequirement}</dd>
              </div>
              <div>
                <dt>Approved capabilities</dt>
                <dd>
                  {Object.entries(institutionPolicy.capabilities)
                    .filter(([, enabled]) => enabled)
                    .map(([name]) => name)
                    .join(", ") || "None"}
                </dd>
              </div>
              <div>
                <dt>K–12 institutional mode</dt>
                <dd>Disabled</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Loading institution policy…</p>
          )}
          {oidcStatus?.enabled ? (
            <div className="stack-sm">
              <p className="notice">
                Link only an identity you control. OpenRound keys the link by institution issuer and
                subject; it never links accounts by matching email addresses.
              </p>
              {federatedIdentities.map((identity) => (
                <div className="identity-row" key={identity.id}>
                  <span>
                    <strong>{oidcStatus.providerName}</strong>
                    <small>
                      {identity.emailHint ?? identity.issuer} · linked{" "}
                      {new Date(identity.linkedAt).toLocaleDateString()}
                    </small>
                  </span>
                  <button
                    className="button-danger small-button"
                    disabled={busy !== ""}
                    onClick={() => void unlinkInstitutionIdentity(identity.id)}
                    type="button"
                  >
                    Unlink
                  </button>
                </div>
              ))}
              {federatedIdentities.length === 0 ? (
                <button
                  className="button-quiet"
                  disabled={busy !== ""}
                  onClick={() => void linkInstitutionIdentity()}
                  type="button"
                >
                  {busy === "federation"
                    ? "Opening institution sign-in…"
                    : `Link ${oidcStatus.providerName}`}
                </button>
              ) : (
                <p className="muted">
                  Institution sign-in URL: <code>/signin?workspaceId={creator?.workspaceId}</code>
                </p>
              )}
            </div>
          ) : (
            <p className="notice">
              Institution sign-in is not enabled for this workspace. Workspace owners cannot
              self-enable contract-gated identity controls.
            </p>
          )}
          {institutionPolicy?.capabilities.lti && creator?.role === "owner" ? (
            <div className="stack-sm institution-registration-list">
              <h3>LTI 1.3 registrations</h3>
              {ltiRegistrations.length ? (
                <ul>
                  {ltiRegistrations.map((registration) => (
                    <li key={registration.id}>
                      <strong>{registration.name}</strong>
                      <span>
                        {registration.issuer} · {registration.deploymentId} · {registration.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notice">
                  LTI is approved but no platform is registered. Your OpenRound operator must add
                  the LMS issuer, client, deployment, JWKS, and return-origin values.
                </p>
              )}
            </div>
          ) : null}
          {institutionPolicy?.capabilities.auditExports && creator?.role === "owner" ? (
            <div className="stack-sm">
              <h3>Institution audit export</h3>
              <p className="muted">
                Download up to 10,000 ordered administrative and facilitator events with actor,
                request, target, timestamp, and region context. Large exports are explicitly marked
                as truncated.
              </p>
              <button
                className="button-quiet"
                disabled={busy !== ""}
                onClick={() => void downloadAuditExport()}
                type="button"
              >
                {busy === "audit" ? "Preparing audit export…" : "Download audit JSON"}
              </button>
            </div>
          ) : null}
        </section>
        <section className="panel">
          <p className="eyebrow">Presentation security</p>
          <h2 style={{ fontSize: "1.8rem" }}>Secure embed origins</h2>
          <p className="muted">
            Presenter embeds are read-only and work only inside these HTTPS origins. Enter one
            origin per line, without a path, up to ten. New presenter credentials capture the
            current list.
          </p>
          <form onSubmit={saveEmbedOrigins}>
            <label className="field" htmlFor="embed-origins">
              <span>Allowed HTTPS origins</span>
              <textarea
                className="textarea"
                disabled={creator?.role !== "owner" || busy !== ""}
                id="embed-origins"
                onChange={(event) => setEmbedOrigins(event.target.value)}
                placeholder={"https://lms.example.edu\nhttps://slides.example.org"}
                rows={5}
                value={embedOrigins}
              />
            </label>
            {creator?.role === "owner" ? (
              <button className="button-quiet" disabled={busy !== ""} type="submit">
                {busy === "embed" ? "Saving…" : "Save embed origins"}
              </button>
            ) : (
              <p className="notice">Only a workspace owner can change embed origins.</p>
            )}
          </form>
        </section>
        <section className="panel">
          <p className="eyebrow">Subscription</p>
          <h2 style={{ fontSize: "1.8rem" }}>
            {creator ? `${effectivePlan} plan` : "Loading plan…"}
          </h2>
          <p className="muted">
            Hosted billing is disabled in community deployments. Hosted Pro customers manage payment
            details and cancellation through the secure billing portal.
          </p>
          {entitlements ? (
            <p className="muted">
              Up to {entitlements.maxParticipants} live participants ·{" "}
              {entitlements.maxPublishedQuizzes === null
                ? "unlimited published checkpoint sets"
                : `${entitlements.maxPublishedQuizzes} published checkpoint sets`}
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
        {creator?.role === "owner" ? (
          <section className="panel workspace-members-panel">
            <p className="eyebrow">Collaboration</p>
            <h2 style={{ fontSize: "1.8rem" }}>Workspace members</h2>
            <p className="muted">
              Editors can create, host, and view reports. Viewers have read-only access. Live
              cohosts use separate, revocable round credentials.
            </p>
            <form className="toolbar" onSubmit={(event) => void inviteMember(event)}>
              <label className="field workspace-invite-email">
                <span>Email address</span>
                <input
                  className="input"
                  maxLength={320}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select
                  className="select"
                  onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}
                  value={inviteRole}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              <button
                className="button"
                disabled={collaborationBusy !== ""}
                style={{ alignSelf: "end" }}
                type="submit"
              >
                {collaborationBusy === "invite" ? "Sending…" : "Invite member"}
              </button>
            </form>
            {inviteUrl ? (
              <p className="notice">
                Local invitation link: <a href={inviteUrl}>open invitation</a>
              </p>
            ) : null}
            <div className="table-scroll" role="region" aria-label="Workspace members" tabIndex={0}>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId}>
                      <td>{member.email}</td>
                      <td>
                        {member.role === "owner" ? (
                          "Owner"
                        ) : (
                          <select
                            aria-label={`Role for ${member.email}`}
                            className="select compact-select"
                            disabled={collaborationBusy === `member:${member.userId}`}
                            onChange={(event) =>
                              void updateMemberRole(
                                member.userId,
                                event.target.value as "editor" | "viewer",
                              )
                            }
                            value={member.role}
                          >
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {member.role !== "owner" ? (
                          <button
                            className="button-danger small-button"
                            disabled={collaborationBusy === `member:${member.userId}`}
                            onClick={() => void removeMember(member.userId)}
                            type="button"
                          >
                            Remove
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invitations.some((invitation) => !invitation.acceptedAt && !invitation.revokedAt) ? (
              <div className="workspace-invitations">
                <h3>Pending invitations</h3>
                <ul>
                  {invitations
                    .filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)
                    .map((invitation) => (
                      <li key={invitation.id}>
                        <span>
                          {invitation.email} · {invitation.role} · expires{" "}
                          {new Date(invitation.expiresAt).toLocaleDateString()}
                        </span>
                        <button
                          className="button-danger small-button"
                          disabled={collaborationBusy === `invitation:${invitation.id}`}
                          onClick={() => void revokeInvitation(invitation.id)}
                          type="button"
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
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
            Download your profile, workspace, checkpoint-set versions, media metadata, live-session
            data, reports, billing state, consent, and audit records as UTF-8 JSON. Secret token
            hashes are excluded.
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
            This removes owned workspaces, checkpoint sets, private image objects, sessions,
            responses, reports, and cached live state, revokes your sign-in sessions, and anonymizes
            your email. This cannot be undone.
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
    </div>
  );

  if (uxBeta) {
    return (
      <WorkspaceProvider>
        <WorkspaceShell
          description={
            creator
              ? `${creator.email} · ${creator.segment} · ${effectivePlan} plan`
              : "Manage membership, integrations, privacy, billing, and data for this workspace."
          }
          eyebrow="Account and data"
          requireBeta={false}
          title="Workspace settings"
        >
          {content}
        </WorkspaceShell>
      </WorkspaceProvider>
    );
  }

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
        {content}
      </main>
    </>
  );
}
