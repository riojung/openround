"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Entitlements, QuizDraft } from "@openround/contracts";
import { AuthoringAssistant } from "../../components/authoring-assistant";
import { Brand } from "../../components/brand";
import { CheckpointSetImport } from "../../components/checkpoint-set-import";
import { API_URL, apiFetch, humanError } from "../../lib/api";

interface Creator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  role: "owner" | "editor" | "viewer";
  plan: "free" | "pro" | "team";
}

interface QuizRecord {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
  folderId: string | null;
  tags: string[];
  updatedAt: string;
}

interface FolderRecord {
  id: string;
  name: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<FolderRecord | null>(null);
  const [organizingId, setOrganizingId] = useState("");
  const [organizationFolderId, setOrganizationFolderId] = useState("");
  const [organizationTags, setOrganizationTags] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(
    async (includeArchived: boolean) => {
      try {
        const [me, list, folderList] = await Promise.all([
          apiFetch<{ creator: Creator; entitlements: Entitlements }>("/v1/auth/me"),
          apiFetch<{ quizzes: QuizRecord[] }>(
            `/v1/quizzes${includeArchived ? "?archived=true" : ""}`,
          ),
          apiFetch<{ folders: FolderRecord[] }>("/v1/folders"),
        ]);
        setCreator(me.creator);
        setEntitlements(me.entitlements);
        setQuizzes(list.quizzes);
        setFolders(folderList.folders);
      } catch (caught) {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    setLoading(true);
    void refresh(showArchived);
  }, [refresh, showArchived]);

  async function createQuiz(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await apiFetch<{ quiz: QuizRecord }>("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({ title, description: "" }),
      });
      router.push(`/quiz/${response.quiz.id}`);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function duplicate(quizId: string) {
    setBusyId(quizId);
    try {
      await apiFetch(`/v1/quizzes/${quizId}/duplicate`, { method: "POST", body: "{}" });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function setArchived(quizId: string, archived: boolean) {
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived }),
      });
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    setBusyId("folder-create");
    setError("");
    try {
      await apiFetch("/v1/folders", {
        method: "POST",
        body: JSON.stringify({ name: newFolderName }),
      });
      setNewFolderName("");
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function renameFolder(event: FormEvent) {
    event.preventDefault();
    if (!editingFolder) return;
    setBusyId(editingFolder.id);
    setError("");
    try {
      await apiFetch(`/v1/folders/${editingFolder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editingFolder.name }),
      });
      setEditingFolder(null);
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  async function deleteFolder(folder: FolderRecord) {
    if (
      !window.confirm(
        `Delete the folder “${folder.name}”? Its checkpoint sets will remain in the library.`,
      )
    )
      return;
    setBusyId(folder.id);
    setError("");
    try {
      await apiFetch(`/v1/folders/${folder.id}`, { method: "DELETE" });
      if (folderFilter === folder.id) setFolderFilter("all");
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  function beginOrganizing(quiz: QuizRecord) {
    setOrganizingId(quiz.id);
    setOrganizationFolderId(quiz.folderId ?? "");
    setOrganizationTags(quiz.tags.join(", "));
  }

  async function saveOrganization(event: FormEvent, quizId: string) {
    event.preventDefault();
    setBusyId(quizId);
    setError("");
    try {
      await apiFetch(`/v1/quizzes/${quizId}/organization`, {
        method: "PATCH",
        body: JSON.stringify({
          folderId: organizationFolderId || null,
          tags: organizationTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      setOrganizingId("");
      await refresh(showArchived);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  function host(quizId: string) {
    if (!creator || !entitlements) return;
    router.push(`/host/setup/${quizId}`);
  }

  async function logout() {
    await apiFetch("/v1/auth/logout", { method: "POST", body: "{}" });
    router.replace("/");
  }

  async function upgrade() {
    try {
      const result = await apiFetch<{ url: string }>("/v1/billing/checkout", {
        method: "POST",
        body: "{}",
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function downloadCheckpointSet(quizId: string, format: "json" | "csv" | "qti.zip") {
    setBusyId(quizId);
    setError("");
    try {
      const response = await fetch(`${API_URL}/v1/quizzes/${quizId}/export.${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Export failed (${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `openround-checkpoint-set-${quizId}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleQuizzes = quizzes.filter(
    (quiz) =>
      (folderFilter === "all" ||
        (folderFilter === "unfiled" ? !quiz.folderId : quiz.folderId === folderFilter)) &&
      (!normalizedSearch ||
        quiz.title.toLocaleLowerCase().includes(normalizedSearch) ||
        quiz.description.toLocaleLowerCase().includes(normalizedSearch) ||
        quiz.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedSearch))),
  );
  const publishedQuizCount = quizzes.filter((quiz) => quiz.status === "published").length;
  const canEdit = creator?.role === "owner" || creator?.role === "editor";

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <nav className="button-row" aria-label="Account navigation">
          <Link href="/account">Account</Link>
          <Link href="/pricing">
            {creator?.plan === "free" ? "Free plan" : `${creator?.plan} plan`}
          </Link>
          <button className="button-quiet small-button" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </nav>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Creator workspace</p>
            <h1>Your checkpoint sets</h1>
            <p className="muted">
              {creator ? `${creator.email} · ${creator.segment}` : "Loading workspace…"}
            </p>
          </div>
          {creator?.plan === "free" ? (
            <button className="button-quiet" onClick={() => void upgrade()} type="button">
              Explore Pro
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {entitlements && entitlements.maxPublishedQuizzes !== null ? (
          <p className="notice">
            {publishedQuizCount} of {entitlements.maxPublishedQuizzes} published checkpoint-set
            slots used on the {entitlements.plan} plan. Draft and archived sets do not use a slot.
          </p>
        ) : null}
        {canEdit ? (
          <section
            className="panel"
            style={{ marginBottom: 28 }}
            aria-labelledby="new-quiz-heading"
          >
            <h2 id="new-quiz-heading" style={{ fontSize: "1.5rem" }}>
              Start a new checkpoint set
            </h2>
            <form className="toolbar" onSubmit={createQuiz}>
              <label className="field" style={{ flex: "1 1 280px", marginBottom: 0 }}>
                <span>Checkpoint set title</span>
                <input
                  className="input"
                  disabled={loading || !creator}
                  maxLength={160}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Friday knowledge check"
                  required
                  value={title}
                />
              </label>
              <button
                className="button"
                disabled={loading || !creator}
                style={{ alignSelf: "end" }}
                type="submit"
              >
                Create checkpoint set
              </button>
            </form>
          </section>
        ) : creator ? (
          <p className="notice">Viewer access is read-only for checkpoint sets and reports.</p>
        ) : null}
        {canEdit && entitlements ? (
          <CheckpointSetImport
            enabled={entitlements.csvExport}
            onImported={() => refresh(showArchived)}
            onUpgrade={() => void upgrade()}
          />
        ) : null}
        {creator ? <AuthoringAssistant canEdit={canEdit} /> : null}
        {canEdit ? (
          <details className="panel folder-manager">
            <summary>Manage folders</summary>
            <form className="toolbar folder-create" onSubmit={createFolder}>
              <label className="field">
                <span>New folder name</span>
                <input
                  className="input"
                  maxLength={80}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  required
                  value={newFolderName}
                />
              </label>
              <button
                className="button-quiet small-button"
                disabled={busyId === "folder-create"}
                type="submit"
              >
                Add folder
              </button>
            </form>
            {folders.length ? (
              <ul className="folder-list">
                {folders.map((folder) => (
                  <li key={folder.id}>
                    {editingFolder?.id === folder.id ? (
                      <form className="toolbar" onSubmit={renameFolder}>
                        <label className="field">
                          <span className="sr-only">Rename {folder.name}</span>
                          <input
                            autoFocus
                            className="input"
                            maxLength={80}
                            onChange={(event) =>
                              setEditingFolder({ ...editingFolder, name: event.target.value })
                            }
                            required
                            value={editingFolder.name}
                          />
                        </label>
                        <button className="button-quiet small-button" type="submit">
                          Save
                        </button>
                        <button
                          className="button-quiet small-button"
                          onClick={() => setEditingFolder(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <span>{folder.name}</span>
                        <div className="button-row">
                          <button
                            className="button-quiet small-button"
                            onClick={() => setEditingFolder(folder)}
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            className="danger-link"
                            disabled={busyId === folder.id}
                            onClick={() => void deleteFolder(folder)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No folders yet.</p>
            )}
          </details>
        ) : null}
        <section className="library-controls" aria-label="Checkpoint-set library filters">
          <label className="field library-search">
            <span>Search checkpoint sets</span>
            <input
              className="input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or description"
              type="search"
              value={search}
            />
          </label>
          <label className="field library-folder-filter">
            <span>Folder</span>
            <select
              className="select"
              onChange={(event) => setFolderFilter(event.target.value)}
              value={folderFilter}
            >
              <option value="all">All folders</option>
              <option value="unfiled">Unfiled</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-field">
            <input
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              type="checkbox"
            />
            Include archived sets
          </label>
        </section>
        {loading ? <p>Loading checkpoint sets…</p> : null}
        {!loading && visibleQuizzes.length === 0 ? (
          <section className="panel">
            <h2 style={{ fontSize: "1.6rem" }}>
              {quizzes.length === 0 ? "Your first round starts here." : "No checkpoint sets match."}
            </h2>
            <p className="muted">
              {quizzes.length === 0 && canEdit
                ? "Create a set above, add a few focused checkpoints, and publish it when it is ready."
                : quizzes.length === 0
                  ? "No checkpoint sets have been shared in this workspace yet."
                  : "Try a different search or include archived sets."}
            </p>
          </section>
        ) : null}
        <section className="quiz-grid" aria-label="Checkpoint-set library">
          {visibleQuizzes.map((quiz) => (
            <article className="card quiz-card" key={quiz.id}>
              <div>
                <span className="status-pill">{quiz.status}</span>
              </div>
              <h2 style={{ fontSize: "1.65rem", marginTop: 18 }}>{quiz.title}</h2>
              {quiz.folderId || quiz.tags.length ? (
                <div className="library-metadata">
                  {quiz.folderId ? (
                    <span className="folder-label">
                      {folders.find((folder) => folder.id === quiz.folderId)?.name ?? "Folder"}
                    </span>
                  ) : null}
                  {quiz.tags.map((tag) => (
                    <span className="tag-label" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <p>
                {quiz.draft.questions.length} checkpoint
                {quiz.draft.questions.length === 1 ? "" : "s"}
              </p>
              <div className="button-row">
                {quiz.status !== "archived" && canEdit ? (
                  <Link className="button-quiet small-button" href={`/quiz/${quiz.id}`}>
                    Edit
                  </Link>
                ) : null}
                {!canEdit && quiz.status !== "archived" ? (
                  <Link className="button-quiet small-button" href={`/quiz/${quiz.id}/preview`}>
                    View
                  </Link>
                ) : null}
                {canEdit && quiz.currentVersionId && quiz.status !== "archived" ? (
                  <button
                    className="button small-button"
                    disabled={busyId === quiz.id || !entitlements}
                    onClick={() => void host(quiz.id)}
                    type="button"
                  >
                    Host
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void duplicate(quiz.id)}
                    type="button"
                  >
                    Duplicate
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    className="button-quiet small-button"
                    onClick={() => beginOrganizing(quiz)}
                    type="button"
                  >
                    Organize
                  </button>
                ) : null}
                {canEdit ? (
                  quiz.status === "archived" ? (
                    <button
                      className="button-quiet small-button"
                      disabled={busyId === quiz.id}
                      onClick={() => void setArchived(quiz.id, false)}
                      type="button"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      className="danger-link"
                      disabled={busyId === quiz.id}
                      onClick={() => void setArchived(quiz.id, true)}
                      type="button"
                    >
                      Archive
                    </button>
                  )
                ) : null}
                {entitlements?.csvExport ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void downloadCheckpointSet(quiz.id, "json")}
                    type="button"
                  >
                    Export JSON
                  </button>
                ) : null}
                {entitlements?.csvExport ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void downloadCheckpointSet(quiz.id, "csv")}
                    type="button"
                  >
                    Export CSV
                  </button>
                ) : null}
                {entitlements?.csvExport ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyId === quiz.id}
                    onClick={() => void downloadCheckpointSet(quiz.id, "qti.zip")}
                    type="button"
                  >
                    Export QTI 3
                  </button>
                ) : null}
              </div>
              {organizingId === quiz.id ? (
                <form
                  className="quiz-organization"
                  onSubmit={(event) => void saveOrganization(event, quiz.id)}
                >
                  <label className="field">
                    <span>Folder</span>
                    <select
                      className="select"
                      onChange={(event) => setOrganizationFolderId(event.target.value)}
                      value={organizationFolderId}
                    >
                      <option value="">Unfiled</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Tags, separated by commas</span>
                    <input
                      className="input"
                      onChange={(event) => setOrganizationTags(event.target.value)}
                      placeholder="onboarding, safety"
                      value={organizationTags}
                    />
                  </label>
                  <div className="button-row">
                    <button className="button small-button" type="submit">
                      Save organization
                    </button>
                    <button
                      className="button-quiet small-button"
                      onClick={() => setOrganizingId("")}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
