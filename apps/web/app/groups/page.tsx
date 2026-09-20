"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiFetch, humanError } from "../../lib/api";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import styles from "./groups.module.css";

type ArtifactType = "round" | "presentation";

interface GroupSummary {
  id: string;
  name: string;
  description: string;
  role: "owner" | "member";
  memberCount: number;
  artifactCount: number;
  upcomingCount: number;
  createdAt: string;
  updatedAt: string;
}

interface GroupMember {
  userId: string;
  email: string;
  role: "owner" | "member";
  workspaceRole: "owner" | "editor" | "viewer" | null;
  joinedAt: string;
}

interface AvailableMember {
  userId: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  joinedAt: string | null;
}

interface GroupArtifact {
  id: string;
  artifactType: ArtifactType;
  artifactId: string;
  title: string;
  status: "draft" | "published" | "archived";
  published: boolean;
  editHref: string;
  hostHref: string;
  assignHref: string | null;
  createdAt: string;
}

interface GroupMessage {
  id: string;
  authorId: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

interface GroupScheduleItem {
  id: string;
  artifactType: ArtifactType;
  artifactId: string;
  artifactTitle: string;
  kind: "live_session" | "round_assignment";
  scheduledFor: string;
  note: string;
  createdAt: string;
}

interface GroupDetail extends GroupSummary {
  members: GroupMember[];
  availableMembers: AvailableMember[];
  artifacts: GroupArtifact[];
  messages: GroupMessage[];
  schedule: GroupScheduleItem[];
}

interface LibraryArtifact {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  currentVersionId: string | null;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function artifactKey(type: ArtifactType, id: string) {
  return `${type}:${id}`;
}

function readArtifactKey(value: string): { artifactType: ArtifactType; artifactId: string } | null {
  const divider = value.indexOf(":");
  if (divider < 0) return null;
  const artifactType = value.slice(0, divider);
  const artifactId = value.slice(divider + 1);
  if ((artifactType !== "round" && artifactType !== "presentation") || !artifactId) return null;
  return { artifactType, artifactId };
}

function GroupsContent() {
  const { canEdit, creator, productFeatures } = useWorkspace();
  const presentationsEnabled = productFeatures?.presentations === true;
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [rounds, setRounds] = useState<LibraryArtifact[]>([]);
  const [presentations, setPresentations] = useState<LibraryArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [memberId, setMemberId] = useState("");
  const [shareKey, setShareKey] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [scheduleKey, setScheduleKey] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"live_session" | "round_assignment">(
    "live_session",
  );
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");

  const refreshGroups = useCallback(async () => {
    const response = await apiFetch<{ groups: GroupSummary[] }>("/v1/groups");
    setGroups(response.groups);
    setSelectedId((current) =>
      response.groups.some((group) => group.id === current)
        ? current
        : (response.groups[0]?.id ?? ""),
    );
  }, []);

  const normalizeDetail = useCallback(
    (group: GroupDetail): GroupDetail =>
      presentationsEnabled
        ? group
        : {
            ...group,
            artifacts: group.artifacts.filter((artifact) => artifact.artifactType === "round"),
            schedule: group.schedule.filter((item) => item.artifactType === "round"),
          },
    [presentationsEnabled],
  );

  const refreshDetail = useCallback(
    async (groupId: string) => {
      const response = await apiFetch<{ group: GroupDetail }>(`/v1/groups/${groupId}`);
      setDetail(normalizeDetail(response.group));
    },
    [normalizeDetail],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const requests: Array<Promise<unknown>> = [
      apiFetch<{ groups: GroupSummary[] }>("/v1/groups", { signal: controller.signal }).then(
        (response) => {
          setGroups(response.groups);
          setSelectedId(response.groups[0]?.id ?? "");
        },
      ),
    ];
    if (canEdit) {
      requests.push(
        Promise.all([
          apiFetch<{ quizzes: LibraryArtifact[] }>("/v1/quizzes?archived=true&summary=true", {
            signal: controller.signal,
          }),
          presentationsEnabled
            ? apiFetch<{ presentations: LibraryArtifact[] }>("/v1/presentations", {
                signal: controller.signal,
              })
            : Promise.resolve({ presentations: [] }),
        ]).then(([roundResponse, presentationResponse]) => {
          setRounds(roundResponse.quizzes.filter((round) => round.status !== "archived"));
          setPresentations(
            presentationResponse.presentations.filter(
              (presentation) => presentation.status !== "archived",
            ),
          );
        }),
      );
    }
    void Promise.all(requests)
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canEdit, presentationsEnabled]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setError("");
    void apiFetch<{ group: GroupDetail }>(`/v1/groups/${selectedId}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setDetail(normalizeDetail(response.group));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [normalizeDetail, selectedId]);

  const visibleGroups = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("en-CA");
    return groups.filter(
      (group) =>
        !normalized ||
        group.name.toLocaleLowerCase("en-CA").includes(normalized) ||
        group.description.toLocaleLowerCase("en-CA").includes(normalized),
    );
  }, [groups, search]);

  const shareCandidates = useMemo(() => {
    const shared = new Set(
      (detail?.artifacts ?? []).map((artifact) =>
        artifactKey(artifact.artifactType, artifact.artifactId),
      ),
    );
    return [
      ...rounds.map((artifact) => ({ ...artifact, artifactType: "round" as const })),
      ...presentations.map((artifact) => ({
        ...artifact,
        artifactType: "presentation" as const,
      })),
    ].filter((artifact) => !shared.has(artifactKey(artifact.artifactType, artifact.id)));
  }, [detail?.artifacts, presentations, rounds]);

  const scheduledArtifact = detail?.artifacts.find(
    (artifact) => artifactKey(artifact.artifactType, artifact.artifactId) === scheduleKey,
  );
  const canManageMembers = detail?.role === "owner" || creator?.role === "owner";

  async function runMutation(label: string, mutation: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await mutation();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy("");
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    await runMutation("create", async () => {
      const response = await apiFetch<{ group: GroupSummary }>("/v1/groups", {
        method: "POST",
        body: JSON.stringify({ name, description: groupDescription.trim() }),
      });
      setGroupName("");
      setGroupDescription("");
      setShowCreate(false);
      await refreshGroups();
      setSelectedId(response.group.id);
      setNotice(`${response.group.name} is ready for collaboration.`);
    });
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !memberId) return;
    await runMutation("member", async () => {
      await apiFetch(`/v1/groups/${detail.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: memberId }),
      });
      setMemberId("");
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice("The workspace member was added to this group.");
    });
  }

  async function shareArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const artifact = readArtifactKey(shareKey);
    if (!artifact) return;
    await runMutation("share", async () => {
      await apiFetch(`/v1/groups/${detail.id}/artifacts`, {
        method: "POST",
        body: JSON.stringify(artifact),
      });
      setShareKey("");
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice("The artifact is now shared with this group.");
    });
  }

  async function removeArtifact(artifact: GroupArtifact) {
    if (!detail) return;
    await runMutation(`remove:${artifact.id}`, async () => {
      await apiFetch(`/v1/groups/${detail.id}/artifacts/${artifact.id}`, { method: "DELETE" });
      if (scheduleKey === artifactKey(artifact.artifactType, artifact.artifactId)) {
        setScheduleKey("");
      }
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice(`${artifact.title} was removed from the group.`);
    });
  }

  async function postMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !messageBody.trim()) return;
    await runMutation("message", async () => {
      await apiFetch(`/v1/groups/${detail.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: messageBody.trim() }),
      });
      setMessageBody("");
      await refreshDetail(detail.id);
      setNotice("Your update was posted.");
    });
  }

  async function scheduleArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !scheduledFor) return;
    const artifact = readArtifactKey(scheduleKey);
    if (!artifact) return;
    await runMutation("schedule", async () => {
      await apiFetch(`/v1/groups/${detail.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          ...artifact,
          kind: artifact.artifactType === "presentation" ? "live_session" : scheduleKind,
          scheduledFor: new Date(scheduledFor).toISOString(),
          note: scheduleNote.trim(),
        }),
      });
      setScheduledFor("");
      setScheduleNote("");
      await Promise.all([refreshDetail(detail.id), refreshGroups()]);
      setNotice("The activity was added to the group schedule.");
    });
  }

  return (
    <WorkspaceShell
      actions={
        canEdit ? (
          <button
            className="button"
            onClick={() => setShowCreate((current) => !current)}
            type="button"
          >
            {showCreate ? "Close" : "Create group"}
          </button>
        ) : null
      }
      description="Curate activities, coordinate facilitators, and plan delivery without requiring learner accounts."
      eyebrow="Facilitator collaboration"
      requiredFeature="groups"
      title="Groups"
    >
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {showCreate ? (
        <form className={styles.createPanel} onSubmit={createGroup}>
          <div>
            <p className={styles.eyebrow}>New facilitator space</p>
            <h2>Create a group</h2>
            <p>Start with a clear purpose. You can add workspace members and artifacts next.</p>
          </div>
          <label className={styles.field}>
            <span>Group name</span>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Sales onboarding cohort"
              required
              value={groupName}
            />
          </label>
          <label className={styles.field}>
            <span>Description</span>
            <textarea
              maxLength={1000}
              onChange={(event) => setGroupDescription(event.target.value)}
              placeholder="What this group will curate and coordinate"
              rows={2}
              value={groupDescription}
            />
          </label>
          <button
            className="button"
            disabled={busy === "create" || !groupName.trim()}
            type="submit"
          >
            {busy === "create" ? "Creating…" : "Create group"}
          </button>
        </form>
      ) : null}

      <div className={styles.workspaceGrid}>
        <aside className={styles.groupRail} aria-label="Workspace groups">
          <label className={styles.searchField}>
            <span className="sr-only">Search groups</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search groups"
              type="search"
              value={search}
            />
          </label>
          {loading ? <div className={styles.railLoading} aria-label="Loading groups" /> : null}
          {!loading && visibleGroups.length ? (
            <div className={styles.groupList}>
              {visibleGroups.map((group) => (
                <button
                  aria-pressed={selectedId === group.id}
                  className={
                    selectedId === group.id ? styles.groupButtonActive : styles.groupButton
                  }
                  key={group.id}
                  onClick={() => setSelectedId(group.id)}
                  type="button"
                >
                  <span className={styles.groupMonogram} aria-hidden="true">
                    {group.name.charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.groupButtonCopy}>
                    <strong>{group.name}</strong>
                    <small>
                      {group.memberCount} {group.memberCount === 1 ? "member" : "members"} ·{" "}
                      {group.artifactCount} {group.artifactCount === 1 ? "artifact" : "artifacts"}
                    </small>
                  </span>
                  {group.upcomingCount ? (
                    <span className={styles.count} aria-label={`${group.upcomingCount} upcoming`}>
                      {group.upcomingCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {!loading && groups.length > 0 && visibleGroups.length === 0 ? (
            <p className={styles.railEmpty}>No groups match that search.</p>
          ) : null}
          {!loading && groups.length === 0 ? (
            <div className={styles.railEmpty}>
              <strong>No groups yet</strong>
              <span>Create a focused space for your facilitator team.</span>
            </div>
          ) : null}
        </aside>

        <div className={styles.detailColumn}>
          {detailLoading ? (
            <div className={styles.detailLoading} aria-label="Loading group" />
          ) : null}
          {!detailLoading && !detail ? (
            <section className={styles.emptyState}>
              <span aria-hidden="true">G</span>
              <h2>{groups.length ? "Choose a group" : "Bring your facilitators together"}</h2>
              <p>
                {groups.length
                  ? "Select a group to see its shared artifacts, people, discussion, and schedule."
                  : "Groups keep curation and planning inside the workspace while learner participation stays account-free."}
              </p>
              {canEdit && !groups.length ? (
                <button className="button" onClick={() => setShowCreate(true)} type="button">
                  Create your first group
                </button>
              ) : null}
            </section>
          ) : null}
          {!detailLoading && detail ? (
            <>
              <GroupOverview detail={detail} />
              <SharedArtifacts
                busy={busy}
                canEdit={canEdit}
                detail={detail}
                onRemove={removeArtifact}
                onShare={shareArtifact}
                setShareKey={setShareKey}
                shareCandidates={shareCandidates}
                shareKey={shareKey}
              />
              <div className={styles.collaborationGrid}>
                <MembersPanel
                  busy={busy}
                  canManageMembers={Boolean(canManageMembers)}
                  detail={detail}
                  memberId={memberId}
                  onAdd={addMember}
                  setMemberId={setMemberId}
                />
                <DiscussionPanel
                  busy={busy}
                  detail={detail}
                  messageBody={messageBody}
                  onPost={postMessage}
                  setMessageBody={setMessageBody}
                />
              </div>
              <SchedulePanel
                busy={busy}
                canEdit={canEdit}
                detail={detail}
                onSchedule={scheduleArtifact}
                scheduledArtifact={scheduledArtifact}
                scheduledFor={scheduledFor}
                scheduleKey={scheduleKey}
                scheduleKind={scheduleKind}
                scheduleNote={scheduleNote}
                setScheduledFor={setScheduledFor}
                setScheduleKey={setScheduleKey}
                setScheduleKind={setScheduleKind}
                setScheduleNote={setScheduleNote}
              />
            </>
          ) : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}

function GroupOverview({ detail }: { detail: GroupDetail }) {
  return (
    <section className={styles.groupHero}>
      <div className={styles.heroHeading}>
        <span className={styles.heroMonogram} aria-hidden="true">
          {detail.name.charAt(0).toUpperCase()}
        </span>
        <div>
          <div className={styles.inlineMeta}>
            <span className={styles.roleBadge}>{detail.role}</span>
            <span>Facilitator group</span>
          </div>
          <h2>{detail.name}</h2>
          <p>{detail.description || "A shared space for facilitator planning and delivery."}</p>
        </div>
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>Members</dt>
          <dd>{detail.members.length}</dd>
        </div>
        <div>
          <dt>Shared</dt>
          <dd>{detail.artifacts.length}</dd>
        </div>
        <div>
          <dt>Upcoming</dt>
          <dd>
            {detail.schedule.filter((item) => new Date(item.scheduledFor) >= new Date()).length}
          </dd>
        </div>
      </dl>
    </section>
  );
}

interface SharedArtifactsProps {
  busy: string;
  canEdit: boolean;
  detail: GroupDetail;
  onRemove: (artifact: GroupArtifact) => Promise<void>;
  onShare: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setShareKey: (value: string) => void;
  shareCandidates: Array<LibraryArtifact & { artifactType: ArtifactType }>;
  shareKey: string;
}

function SharedArtifacts({
  busy,
  canEdit,
  detail,
  onRemove,
  onShare,
  setShareKey,
  shareCandidates,
  shareKey,
}: SharedArtifactsProps) {
  return (
    <section className={styles.panel}>
      <SectionHeading
        count={detail.artifacts.length}
        eyebrow="Curated collection"
        title="Shared artifacts"
      />
      {canEdit ? (
        <form className={styles.compactForm} onSubmit={onShare}>
          <label className={styles.field}>
            <span>Round or Presentation</span>
            <select onChange={(event) => setShareKey(event.target.value)} value={shareKey}>
              <option value="">Choose from your Library</option>
              {shareCandidates.map((artifact) => (
                <option
                  key={artifactKey(artifact.artifactType, artifact.id)}
                  value={artifactKey(artifact.artifactType, artifact.id)}
                >
                  {artifact.artifactType === "round" ? "Round" : "Presentation"} · {artifact.title}
                  {artifact.currentVersionId ? "" : " (draft)"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button small-button"
            disabled={busy === "share" || !shareKey}
            type="submit"
          >
            {busy === "share" ? "Sharing…" : "Share"}
          </button>
        </form>
      ) : null}
      {detail.artifacts.length ? (
        <div className={styles.artifactGrid}>
          {detail.artifacts.map((artifact) => (
            <article className={styles.artifactCard} key={artifact.id}>
              <div
                className={styles.artifactType}
                data-type={artifact.artifactType}
                aria-hidden="true"
              >
                {artifact.artifactType === "round" ? "R" : "P"}
              </div>
              <div className={styles.artifactCopy}>
                <div className={styles.inlineMeta}>
                  <span>{artifact.artifactType}</span>
                  <span className={styles.statusBadge} data-status={artifact.status}>
                    {artifact.status}
                  </span>
                </div>
                <h3>{artifact.title}</h3>
                <div className={styles.cardActions}>
                  <Link className="button-quiet small-button" href={artifact.editHref}>
                    {canEdit ? "Edit" : "View"}
                  </Link>
                  {canEdit && artifact.published ? (
                    <Link className="button small-button" href={artifact.hostHref}>
                      Host
                    </Link>
                  ) : null}
                  {canEdit && artifact.published && artifact.assignHref ? (
                    <Link className="button-quiet small-button" href={artifact.assignHref}>
                      Assign
                    </Link>
                  ) : null}
                  {canEdit ? (
                    <button
                      className={styles.removeButton}
                      disabled={busy === `remove:${artifact.id}`}
                      onClick={() => void onRemove(artifact)}
                      type="button"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <PanelEmpty
          strong="No shared artifacts yet"
          text="Add a Round or Presentation from the workspace Library."
        />
      )}
    </section>
  );
}

function MembersPanel({
  busy,
  canManageMembers,
  detail,
  memberId,
  onAdd,
  setMemberId,
}: {
  busy: string;
  canManageMembers: boolean;
  detail: GroupDetail;
  memberId: string;
  onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setMemberId: (value: string) => void;
}) {
  return (
    <section className={styles.panel}>
      <SectionHeading count={detail.members.length} eyebrow="Facilitator team" title="Members" />
      {canManageMembers && detail.availableMembers.length ? (
        <form className={styles.compactForm} onSubmit={onAdd}>
          <label className={styles.field}>
            <span>Workspace member</span>
            <select onChange={(event) => setMemberId(event.target.value)} value={memberId}>
              <option value="">Choose a member</option>
              {detail.availableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.email} · {member.role}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button small-button"
            disabled={busy === "member" || !memberId}
            type="submit"
          >
            {busy === "member" ? "Adding…" : "Add"}
          </button>
        </form>
      ) : null}
      <ul className={styles.memberList}>
        {detail.members.map((member) => (
          <li key={member.userId}>
            <span className={styles.avatar} aria-hidden="true">
              {member.email.charAt(0).toUpperCase()}
            </span>
            <span>
              <strong>{member.email}</strong>
              <small>{member.workspaceRole ?? "Former workspace member"}</small>
            </span>
            <span className={styles.roleBadge}>{member.role}</span>
          </li>
        ))}
      </ul>
      {canManageMembers && !detail.availableMembers.length ? (
        <p className={styles.helpText}>
          All available workspace members are already in this group.
        </p>
      ) : null}
    </section>
  );
}

function DiscussionPanel({
  busy,
  detail,
  messageBody,
  onPost,
  setMessageBody,
}: {
  busy: string;
  detail: GroupDetail;
  messageBody: string;
  onPost: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setMessageBody: (value: string) => void;
}) {
  return (
    <section className={styles.panel}>
      <SectionHeading
        count={detail.messages.length}
        eyebrow="Async coordination"
        title="Discussion"
      />
      <form className={styles.messageForm} onSubmit={onPost}>
        <label className={styles.field}>
          <span>Post an update</span>
          <textarea
            maxLength={2000}
            onChange={(event) => setMessageBody(event.target.value)}
            placeholder="Share context, a facilitation note, or a question…"
            rows={3}
            value={messageBody}
          />
        </label>
        <button
          className="button small-button"
          disabled={busy === "message" || !messageBody.trim()}
          type="submit"
        >
          {busy === "message" ? "Posting…" : "Post update"}
        </button>
      </form>
      {detail.messages.length ? (
        <ol className={styles.messageList}>
          {detail.messages.map((message) => (
            <li key={message.id}>
              <div>
                <strong>{message.authorEmail}</strong>
                <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
              </div>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.helpText}>No updates yet. Start the facilitator discussion.</p>
      )}
    </section>
  );
}

interface SchedulePanelProps {
  busy: string;
  canEdit: boolean;
  detail: GroupDetail;
  onSchedule: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  scheduledArtifact: GroupArtifact | undefined;
  scheduledFor: string;
  scheduleKey: string;
  scheduleKind: "live_session" | "round_assignment";
  scheduleNote: string;
  setScheduledFor: (value: string) => void;
  setScheduleKey: (value: string) => void;
  setScheduleKind: (value: "live_session" | "round_assignment") => void;
  setScheduleNote: (value: string) => void;
}

function SchedulePanel({
  busy,
  canEdit,
  detail,
  onSchedule,
  scheduledArtifact,
  scheduledFor,
  scheduleKey,
  scheduleKind,
  scheduleNote,
  setScheduledFor,
  setScheduleKey,
  setScheduleKind,
  setScheduleNote,
}: SchedulePanelProps) {
  return (
    <section className={styles.panel}>
      <SectionHeading count={detail.schedule.length} eyebrow="Delivery plan" title="Schedule" />
      {canEdit ? (
        detail.artifacts.some((artifact) => artifact.published) ? (
          <form className={styles.scheduleForm} onSubmit={onSchedule}>
            <label className={styles.field}>
              <span>Published artifact</span>
              <select
                onChange={(event) => {
                  const next = event.target.value;
                  setScheduleKey(next);
                  if (readArtifactKey(next)?.artifactType === "presentation") {
                    setScheduleKind("live_session");
                  }
                }}
                value={scheduleKey}
              >
                <option value="">Choose a shared artifact</option>
                {detail.artifacts
                  .filter((artifact) => artifact.published)
                  .map((artifact) => (
                    <option
                      key={artifactKey(artifact.artifactType, artifact.artifactId)}
                      value={artifactKey(artifact.artifactType, artifact.artifactId)}
                    >
                      {artifact.artifactType === "round" ? "Round" : "Presentation"} ·{" "}
                      {artifact.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Activity</span>
              <select
                disabled={scheduledArtifact?.artifactType === "presentation"}
                onChange={(event) =>
                  setScheduleKind(event.target.value as "live_session" | "round_assignment")
                }
                value={
                  scheduledArtifact?.artifactType === "presentation" ? "live_session" : scheduleKind
                }
              >
                <option value="live_session">Live session</option>
                {scheduledArtifact?.artifactType !== "presentation" ? (
                  <option value="round_assignment">Round assignment</option>
                ) : null}
              </select>
            </label>
            <label className={styles.field}>
              <span>Date and time</span>
              <input
                onChange={(event) => setScheduledFor(event.target.value)}
                required
                type="datetime-local"
                value={scheduledFor}
              />
            </label>
            <label className={styles.field}>
              <span>Note (optional)</span>
              <input
                maxLength={500}
                onChange={(event) => setScheduleNote(event.target.value)}
                placeholder="Preparation or audience context"
                value={scheduleNote}
              />
            </label>
            <button
              className="button small-button"
              disabled={busy === "schedule" || !scheduleKey || !scheduledFor}
              type="submit"
            >
              {busy === "schedule" ? "Scheduling…" : "Add to schedule"}
            </button>
          </form>
        ) : (
          <p className={styles.helpText}>
            Publish and share a Round or Presentation before scheduling it.
          </p>
        )
      ) : null}
      {detail.schedule.length ? (
        <div className={styles.scheduleList}>
          {detail.schedule.map((item) => {
            const artifact = detail.artifacts.find(
              (candidate) =>
                candidate.artifactType === item.artifactType &&
                candidate.artifactId === item.artifactId,
            );
            const actionHref =
              item.kind === "round_assignment" ? artifact?.assignHref : artifact?.hostHref;
            return (
              <article className={styles.scheduleCard} key={item.id}>
                <time dateTime={item.scheduledFor}>
                  <strong>{formatDateTime(item.scheduledFor)}</strong>
                  <span>{new Date(item.scheduledFor) < new Date() ? "Past" : "Upcoming"}</span>
                </time>
                <div>
                  <p className={styles.inlineMeta}>
                    <span>{item.kind === "live_session" ? "Live session" : "Assignment"}</span>
                    <span>{item.artifactType}</span>
                  </p>
                  <h3>{item.artifactTitle}</h3>
                  {item.note ? <p>{item.note}</p> : null}
                </div>
                {actionHref && canEdit ? (
                  <Link className="button-quiet small-button" href={actionHref}>
                    {item.kind === "live_session" ? "Open host setup" : "Open assignment"}
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <PanelEmpty
          strong="Nothing scheduled"
          text="Plan a live session or Round assignment for this facilitator group."
        />
      )}
    </section>
  );
}

function SectionHeading({
  count,
  eyebrow,
  title,
}: {
  count: number;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <span className={styles.sectionCount}>{count}</span>
    </div>
  );
}

function PanelEmpty({ strong, text }: { strong: string; text: string }) {
  return (
    <div className={styles.panelEmpty}>
      <strong>{strong}</strong>
      <span>{text}</span>
    </div>
  );
}

export default function GroupsPage() {
  return (
    <WorkspaceProvider>
      <GroupsContent />
    </WorkspaceProvider>
  );
}
