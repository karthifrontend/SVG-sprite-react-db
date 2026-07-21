// Left-hand library sidebar. Shows the signed-out CTA when no
// user is authenticated and a grouped list of saved libraries
// (with load / refresh / rename / delete actions) when signed in.
// UI mirrors the "react app with MS" reference, with collapse/
// expand behavior owned by the parent.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useLibrary } from "../../hooks/useLibrary";
import { getSpriteById } from "../../api/sprites";
import {
  UnlockIcon,
  LockIcon,
  RefreshIcon,
  ChevronDoubleLeftIcon,
  ChevronDownIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  DuplicateIcon,
  DownloadIcon,
} from "../icons";
import type { Source as LiveDemoSource } from "./LiveDemo";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { formatDate } from "../../utils/sprite";
import type { SpriteSummary } from "../../api/sprites";
import Modal from "../Modal";

type LibraryGroupVersion = {
  id: string;
  version: number;
  symbolCount: number;
  updatedAt?: string;
  isPublic: boolean;
  isOwner: boolean;
  summary: SpriteSummary;
};

type LibraryGroup = {
  bundleName: string;
  versions: LibraryGroupVersion[];
  isPublic: boolean;
  isOwner: boolean;
};

type LibraryPanelProps = {
  isOpen: boolean;
  onCollapseToggle: () => void;
  onOpenLogin: () => void;
  onLoadToUpdate?: (sprite: SpriteSummary) => void;
  onOpenDemo?: (payload: {
    sprite: string;
    symbolIds: string[];
    source: LiveDemoSource;
  }) => void;
  /**
   * Fired after a library is renamed. The parent can use this to
   * keep in-flight references (e.g. the active bundle name in the
   * compiler) in sync with the new MongoDB name.
   */
  onLibraryRenamed?: (info: { oldName: string; newName: string }) => void;
  /**
   * Fired after a library is deleted. The parent can use this to
   * clear any UI that was pointing at the removed bundle.
   */
  onLibraryDeleted?: (info: { name: string }) => void;
  /**
   * Fired when the user clicks the "Download bundle" button on a
   * library version. The parent owns the bundle builder (zip
   * with sprite.svg + demo.html + preview.png) so the downloaded
   * contents are identical to the Results panel's "Download zip"
   * output. Receives the version's summary so the parent can
   * resolve the full XML via the existing `getSpriteById` call.
   */
  onDownloadBundle?: (summary: SpriteSummary) => void;
};

function LibrarySkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-fade-in-up rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          style={{ animationDelay: `${i * 0.05}s` }}
        >
          <div className="skeleton-shimmer mb-4 h-4 w-1/2 rounded" />
          <div className="space-y-3 border-l-2 border-slate-100 pl-3">
            <div className="skeleton-shimmer h-3 w-3/4 rounded" />
            <div className="mt-2 flex gap-2">
              <div className="skeleton-shimmer h-7 flex-1 rounded" />
              <div className="skeleton-shimmer h-7 w-7 rounded" />
              <div className="skeleton-shimmer h-7 w-7 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type InlineRenameInputProps = {
  currentName: string;
  existingNames: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (next: string) => void;
};

/**
 * Inline text input used in place of the library title while
 * renaming. Enter or blur saves, Escape cancels. The input keeps
 * the same typography as the title so the row doesn't jump.
 */
function InlineRenameInput({
  currentName,
  existingNames,
  busy,
  onCancel,
  onConfirm,
}: InlineRenameInputProps) {
  const [name, setName] = useState(currentName);
  const [touched, setTouched] = useState(false);

  // Keep the field in sync if the parent switches the target row
  // (e.g. another library started editing while we were here).
  useEffect(() => {
    setName(currentName);
    setTouched(false);
  }, [currentName]);

  const trimmed = name.trim();
  const isUnchanged =
    trimmed.toLowerCase() === currentName.trim().toLowerCase();
  const conflict = existingNames
    .filter((n) => n.toLowerCase() !== currentName.trim().toLowerCase())
    .some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const isInvalid = trimmed.length === 0 || trimmed.length > 100 || conflict;
  const showError = touched && isInvalid;

  function trySave() {
    if (busy) return;
    setTouched(true);
    if (isInvalid || isUnchanged) {
      onCancel();
      return;
    }
    onConfirm(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      trySave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <input
        type="text"
        value={name}
        autoFocus
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={trySave}
        onKeyDown={handleKeyDown}
        maxLength={100}
        aria-label={`Rename ${currentName}`}
        className="w-full truncate rounded-md border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-bold text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
        placeholder="my-icon-library"
      />
      {showError && trimmed.length === 0 && (
        <p className="mt-1 text-[10px] text-rose-500">Name is required.</p>
      )}
      {showError && trimmed.length > 100 && (
        <p className="mt-1 text-[10px] text-rose-500">Name is too long.</p>
      )}
      {showError && conflict && (
        <p className="mt-1 text-[10px] text-rose-500">Name already in use.</p>
      )}
    </div>
  );
}

type DeleteVersionModalProps = {
  open: boolean;
  bundleName: string;
  version: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function DeleteVersionModal({
  open,
  bundleName,
  version,
  busy,
  onCancel,
  onConfirm,
}: DeleteVersionModalProps) {
  return (
    <Modal
      isOpen={open}
      onClose={busy ? () => undefined : onCancel}
      maxWidth="max-w-sm"
      ariaLabel="Delete sprite version"
    >
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <TrashIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Delete version?
            </h3>
            <p className="text-[11px] text-slate-500">This cannot be undone.</p>
          </div>
        </div>

        <p className="text-xs text-slate-600">
          You are about to delete{" "}
          <span className="font-semibold text-slate-900">v{version}</span> of{" "}
          <span className="font-semibold text-slate-900">“{bundleName}”</span>{" "}
          from your library. Other versions of this library will remain.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LibraryPanel({
  isOpen,
  onCollapseToggle,
  onOpenLogin,
  onLoadToUpdate,
  onOpenDemo,
  onLibraryRenamed,
  onLibraryDeleted,
  onDownloadBundle,
}: LibraryPanelProps) {
  const { currentUser } = useAuth();
  const {
    sprites,
    loading,
    error,
    refetch,
    renameBundle,
    deleteVersion,
  } = useLibrary(!!currentUser);
  const { showToast } = useToast();
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Inline rename: the bundle name currently being edited. Only one
  // row at a time can be in edit mode. Saving calls the API; the
  // busy flag disables the field while the request is in flight.
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    currentName: string;
  } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  // Pending delete: the version the user wants to remove. We
  // confirm via a modal so a stray click can't wipe data from
  // MongoDB.
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    bundleName: string;
    version: number;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Per-version "Download bundle" busy state. The parent owns the
  // zip build (which includes a `preview.png` render), so a single
  // id is enough to disable just the row that's in flight.
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);

  // Show a brief skeleton only when a refresh is in flight, not on first
  // paint (the panel may render before the user signs in).
  useEffect(() => {
    if (loading && sprites.length === 0) {
      setShowSkeleton(true);
      return undefined;
    }
    const timer = setTimeout(() => setShowSkeleton(false), 350);
    return () => clearTimeout(timer);
  }, [loading, sprites.length]);

  // Accordion state: "Public" rendered first (closed by default),
  // "Private" rendered second (open by default). The split below
  // drives the two sections, so a single group never appears in
  // both lists.
  const [publicOpen, setPublicOpen] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(true);

  const groups = useMemo<LibraryGroup[]>(() => {
    const byName = new Map<string, LibraryGroup>();
    for (const sprite of sprites) {
      const key = (sprite.bundleName || sprite.name || "").trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) {
        byName.set(key, {
          bundleName: sprite.bundleName || sprite.name,
          versions: [],
          // A bundle is "public" / "owned" if any version says so.
          // In practice the server applies the same flag to every
          // version of a bundle, but we OR defensively in case a
          // future change makes them diverge.
          isPublic: false,
          isOwner: false,
        });
      }
      const group = byName.get(key)!;
      const isPublic = !!sprite.isPublic;
      const isOwner = sprite.isOwner !== false;
      if (isPublic) group.isPublic = true;
      if (isOwner) group.isOwner = true;
      group.versions.push({
        id: sprite._id,
        version: sprite.version ?? 1,
        symbolCount: sprite.symbolCount,
        updatedAt: sprite.updatedAt,
        isPublic,
        isOwner,
        summary: sprite,
      });
    }
    // Make sure versions inside a group are sorted newest first.
    for (const group of byName.values()) {
      group.versions.sort((a, b) => b.version - a.version);
    }
    return Array.from(byName.values());
  }, [sprites]);

  // Split the unified group list into the two accordion buckets.
  // "Public" = any version flagged public (typically org-wide),
  // "Private" = anything the signed-in user owns that is not public.
  // Public is rendered first in the panel, Private second.
  const publicGroups = useMemo(
    () => groups.filter((g) => g.isPublic),
    [groups],
  );
  const privateGroups = useMemo(
    () => groups.filter((g) => !g.isPublic),
    [groups],
  );

  // Renders the original library list. Pulled out so the public
  // and private accordions can share identical markup. Each
  // library keeps its own card container for visual separation,
  // while the outer accordion section stays flat (no card).
  function renderGroupList(groupList: LibraryGroup[], listKey: string) {
    return (
      <div className="space-y-2 pb-1">
        {groupList.map((group, groupIdx) => (
          <div
            key={`${listKey}-${group.bundleName}`}
            className="animate-fade-in-up mb-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            style={{ animationDelay: `${groupIdx * 0.05}s` }}
          >
            <div className="group/header mb-2 flex items-center gap-1.5">
              {renamingName === group.bundleName && renameTarget ? (
                <InlineRenameInput
                  currentName={renameTarget.currentName}
                  existingNames={existingLibraryNames}
                  busy={renameBusy}
                  onCancel={cancelRename}
                  onConfirm={handleConfirmRename}
                />
              ) : group.isOwner ? (
                <button
                  type="button"
                  onClick={() => startRename(group)}
                  disabled={renameBusy}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left transition-colors hover:text-indigo-600 disabled:cursor-not-allowed"
                  title="Rename library"
                  aria-label={`Rename ${group.bundleName}`}
                >
                  <h3
                    className="truncate text-sm font-bold text-slate-800"
                    title={group.bundleName}
                  >
                    {group.bundleName}
                  </h3>
                  <PencilIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 opacity-0 transition-opacity group-hover/header:opacity-100" />
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <h3
                    className="truncate text-sm font-bold text-slate-800"
                    title={group.bundleName}
                  >
                    {group.bundleName}
                  </h3>
                </div>
              )}
              {!group.isPublic && (
                <span
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-slate-200/70 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  title={
                    group.isOwner
                      ? "Only you can see and access this library."
                      : "Private — only the owner can access this library."
                  }
                >
                  <LockIcon className="h-3 w-3" />
                  Private
                </span>
              )}
            </div>
            <div className="space-y-2 pl-2">
              {group.versions.map((version) => {
                const isLatest = version === group.versions[0];
                return (
                  <div
                    key={version.id}
                    className="group relative border-l-2 border-indigo-100 pl-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[12px] font-mono font-semibold ${
                            isLatest
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                          title={
                            version.summary.versionLabel
                              ? `Saved as "${version.summary.versionLabel}" · v${version.version}`
                              : undefined
                          }
                        >
                          {version.summary.versionLabel ||
                            `v${version.version}`}
                        </span>
                      </div>
                      <span className="whitespace-nowrap font-mono text-[10px] text-slate-400">
                        {formatDate(version.updatedAt)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      {version.isOwner && (
                        <button
                          type="button"
                          onClick={() => handleLoad(version)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-100"
                        >
                          Update
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const detail = await getSpriteById(version.id);
                            onOpenDemo?.({
                              sprite: detail.xml,
                              symbolIds: detail.symbolIds,
                              source: {
                                type: "library",
                                id: detail.id,
                                name: detail.bundleName || detail.name,
                                version: detail.version,
                                isOwner: version.isOwner,
                                isPublic: version.isPublic,
                              },
                            });
                          } catch (err) {
                            showToast(
                              err instanceof Error
                                ? err.message
                                : "Failed to open demo",
                              "error",
                            );
                          }
                        }}
                        className="rounded bg-slate-50 p-1 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-500"
                        title="Preview icons"
                        aria-label={`Preview ${group.bundleName} v${version.version}`}
                      >
                        <EyeIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDownloadVersion(version);
                        }}
                        disabled={downloadBusyId === version.id}
                        className="rounded bg-slate-50 p-1 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        title={`Download v${version.version} bundle`}
                        aria-label={`Download ${group.bundleName} v${version.version} bundle`}
                      >
                        <DownloadIcon
                          className={`h-3.5 w-3.5 ${
                            downloadBusyId === version.id ? "animate-spin" : ""
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const detail = await getSpriteById(version.id);
                            const ok = await navigator.clipboard
                              ?.writeText(detail.xml)
                              .then(() => true)
                              .catch(() => false);
                            showToast(
                              ok
                                ? `Copied sprite code for ${group.bundleName}(v${version.version})`
                                : "Failed to copy sprite",
                              ok ? "success" : "error",
                            );
                          } catch (err) {
                            showToast(
                              err instanceof Error
                                ? err.message
                                : "Failed to copy sprite",
                              "error",
                            );
                          }
                        }}
                        className="rounded bg-slate-50 p-1 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                        title="Copy sprite XML"
                        aria-label={`Copy ${group.bundleName} v${version.version}`}
                      >
                        <DuplicateIcon className="h-3.5 w-3.5" />
                      </button>
                      {version.isOwner && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeleteModal(version);
                          }}
                          className="rounded bg-slate-50 p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                          title={`Delete v${version.version}`}
                          aria-label={`Delete ${group.bundleName} v${version.version}`}
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const handleRefresh = () => {
    void refetch();
  };

  const handleLoad = (version: LibraryGroupVersion) => {
    onLoadToUpdate?.(version.summary);
    showToast(
      `Loaded ${version.summary.bundleName || version.summary.name} v${version.version}`,
      "success",
    );
  };

  // Per-version bundle download. We delegate the actual zip build
  // to the parent so the contents (sprite.svg + demo.html +
  // preview.png) match the Results panel's "Download zip" output
  // exactly. The library panel only owns the busy flag so the
  // button reflects the in-flight render and the user can't fire
  // two downloads against the same version by accident.
  async function handleDownloadVersion(version: LibraryGroupVersion) {
    if (downloadBusyId) return;
    if (!onDownloadBundle) {
      showToast("Bundle download is not available right now.", "warning");
      return;
    }
    setDownloadBusyId(version.id);
    try {
      await Promise.resolve(onDownloadBundle(version.summary));
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to download bundle.",
        "error",
      );
    } finally {
      setDownloadBusyId(null);
    }
  }

  // Names of every library used to detect rename collisions while
  // editing. Compared case-insensitively inside the input.
  const existingLibraryNames = useMemo(
    () => groups.map((g) => g.bundleName),
    [groups],
  );

  function startRename(group: LibraryGroup) {
    if (group.versions.length === 0) return;
    setRenamingName(group.bundleName);
    setRenameTarget({
      id: group.versions[0].id,
      currentName: group.bundleName,
    });
  }

  function cancelRename() {
    if (renameBusy) return;
    setRenamingName(null);
    setRenameTarget(null);
  }

  async function handleConfirmRename(next: string) {
    if (!renameTarget) return;
    setRenameBusy(true);
    try {
      const oldName = renameTarget.currentName;
      const newName = await renameBundle(renameTarget.id, next);
      showToast(`Renamed to “${newName}”.`, "success");
      onLibraryRenamed?.({ oldName, newName });
      setRenamingName(null);
      setRenameTarget(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to rename library.",
        "error",
      );
    } finally {
      setRenameBusy(false);
    }
  }

  function openDeleteModal(version: LibraryGroupVersion) {
    setPendingDelete({
      id: version.id,
      bundleName:
        version.summary.bundleName || version.summary.name || "",
      version: version.version,
    });
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      const { bundleName, remaining } = await deleteVersion(pendingDelete.id);
      showToast(
        remaining > 0
          ? `Deleted v${pendingDelete.version} of “${bundleName}”.`
          : `Deleted the last version of “${bundleName}”.`,
        "success",
      );
      // Only notify the parent when there are no versions left, so
      // it can clear any references pointing at the removed library.
      if (remaining === 0) {
        onLibraryDeleted?.({ name: bundleName });
      }
      setPendingDelete(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to delete version.",
        "error",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  // Accordion section: flat collapsible header (chevron + title)
  // with the body rendered directly below, no card container.
  // Mirrors the simple grouped-list look (e.g. Folders / Chats in
  // a sidebar): no border, no count badge, no nested background.
  function renderAccordionSection(opts: {
    title: string;
    count: number;
    open: boolean;
    onToggle: () => void;
    body: React.ReactNode;
    emptyMessage: string;
  }) {
    const { title, count, open, onToggle, body, emptyMessage } = opts;
    return (
      <section className="mb-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`accordion-${title.toLowerCase()}`}
          className="flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left transition-colors hover:bg-slate-200/60"
        >
          <ChevronDownIcon
            className={`h-3.5 w-3.5 flex-shrink-0 text-slate-500 transition-transform duration-200 ${
              open ? "" : "-rotate-90"
            }`}
          />
          <span className="truncate text-xs font-semibold text-slate-700">
            {title}
          </span>
        </button>
        {open && (
          <div id={`accordion-${title.toLowerCase()}`} className="pl-4">
            {count === 0 ? (
              <p className="py-2 pl-1 text-[11px] text-slate-400">
                {emptyMessage}
              </p>
            ) : (
              body
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <aside
      aria-label="Organization Library"
      className={`${
        isOpen ? "w-80 flex" : "w-0 hidden"
      } sticky top-[57px] z-30 h-[calc(100vh-57px)] max-h-[calc(100vh-57px)] flex-col border-r border-slate-200 bg-slate-50 shadow-[4px_0_15px_-3px_rgba(0,0,0,0.05)] transition-all duration-300 ease-out`}
    >
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-bold text-slate-900">Library</h2>
        </div>
        <div className="flex items-center gap-1">
          {currentUser && (
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              title="Refresh Library"
              aria-label="Refresh Library"
            >
              <RefreshIcon
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={onCollapseToggle}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
            title="Collapse Library"
            aria-label="Collapse Library"
          >
            <ChevronDoubleLeftIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="custom-scrollbar relative flex-1 overflow-y-auto px-4 py-4">
        {!currentUser && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
              <UnlockIcon className="h-6 w-6 text-indigo-600" />
            </div>
            <h3 className="mb-1 text-sm font-bold text-slate-900">
              Sign in required
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              You need to log in to access the shared organization library.
            </p>
            <button
              type="button"
              onClick={onOpenLogin}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              Log In Now
            </button>
          </div>
        )}

        {currentUser && (
          <div className="flex h-full flex-col">
            {error && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                {error}
              </div>
            )}

            {showSkeleton ? (
              <LibrarySkeleton />
            ) : sprites.length === 0 ? (
              <p className="animate-fade-in-up py-10 text-center text-sm text-slate-500">
                No sprites found in library.
              </p>
            ) : (
              <>
                {renderAccordionSection({
                  title: "Public",
                  count: publicGroups.length,
                  open: publicOpen,
                  onToggle: () => setPublicOpen((prev) => !prev),
                  body: renderGroupList(publicGroups, "public"),
                  emptyMessage: "No public libraries available.",
                })}
                {renderAccordionSection({
                  title: "Private",
                  count: privateGroups.length,
                  open: privateOpen,
                  onToggle: () => setPrivateOpen((prev) => !prev),
                  body: renderGroupList(privateGroups, "private"),
                  emptyMessage: "No private libraries yet.",
                })}
              </>
            )}
          </div>
        )}
      </div>

      <DeleteVersionModal
        open={!!pendingDelete}
        bundleName={pendingDelete?.bundleName ?? ""}
        version={pendingDelete?.version ?? 0}
        busy={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) setPendingDelete(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </aside>
  );
}

export default LibraryPanel;
