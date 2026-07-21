// "Paste Icons To..." modal — opened from the live demo's
// "Copy N Selected" button. Shows a Current Workspace target plus
// every saved library version. Picking a target hands the pending
// icons back through `onPasteIntoWorkspace` or
// `onPasteIntoLibraryVersion`.
import { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import { useLibrary } from "../../hooks/useLibrary";
import { useAuth } from "../../context/AuthContext";
import { formatDate } from "../../utils/sprite";
import type { CopiedIcon } from "./LiveDemo";
import { EyeIcon, LockIcon } from "../icons";

type PasteIconsModalProps = {
  isOpen: boolean;
  icons: CopiedIcon[];
  busy: boolean;
  onClose: () => void;
  /**
   * Paste the icons into the compiler's staging area. The modal
   * closes itself immediately after the call returns so the
   * parent's Preview/Undo toast can appear right away.
   */
  onPasteIntoWorkspace: (icons: CopiedIcon[]) => void;
  /**
   * Paste the icons into a specific library version. The parent
   * reads the existing sprite, merges the new symbols, and saves
   * a new version. The modal closes itself the moment this is
   * invoked; the parent surfaces its own toast.
   */
  onPasteIntoLibraryVersion: (input: {
    spriteId: string;
    bundleName: string;
    version: number;
    icons: CopiedIcon[];
  }) => void;
};

type Target = { kind: "workspace" } | { kind: "library"; id: string; bundleName: string; version: number };

export default function PasteIconsModal({
  isOpen,
  icons,
  busy,
  onClose,
  onPasteIntoWorkspace,
  onPasteIntoLibraryVersion,
}: PasteIconsModalProps) {
  const { currentUser } = useAuth();
  const { sprites, loading, refetch } = useLibrary(!!currentUser);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);

  // Always re-fetch when the modal opens so the user can paste into
  // a library that was just created in another tab.
  useEffect(() => {
    if (isOpen && currentUser) {
      void refetch();
    }
  }, [isOpen, currentUser, refetch]);

  // Group by bundle so the UI can show "Name v1, v2, v3".
  // Pasting can only target libraries the signed-in user owns
  // (the library panel only exposes owner-only actions — load,
  // edit, delete, rename — to non-owners, and the public-by-
  // someone-else case is read-only). Foreign public libraries
  // are filtered out here so the popup mirrors the same
  // "owned only" view the user has in the library panel.
  //
  // Each group carries an `isPublic` flag (OR-reduced across its
  // versions) so the per-group Public badge only renders for
  // bundles the owner has actually flipped to public. Private
  // bundles show no badge — same as the library panel.
  const groups = useMemo(() => {
    const byName = new Map<
      string,
      {
        bundleName: string;
        isPublic: boolean;
        versions: { id: string; version: number; updatedAt?: string; isOwner: boolean; isPublic: boolean }[];
      }
    >();
    for (const sprite of sprites) {
      // Skip libraries owned by other users. The server's
      // `listSprites` returns every version of every visible
      // bundle (owner OR public), so we still see foreign
      // public rows in `sprites` and have to drop them here.
      if (sprite.isOwner === false) continue;
      const key = (sprite.bundleName || sprite.name || "").trim();
      if (!key) continue;
      if (!byName.has(key)) {
        byName.set(key, {
          bundleName: sprite.bundleName || sprite.name,
          isPublic: false,
          versions: [],
        });
      }
      const group = byName.get(key)!;
      // A bundle is "public" if any of its versions say so. In
      // practice the server keeps the flag consistent across
      // versions, but we OR defensively so a stray miss doesn't
      // hide a real Public badge.
      const versionIsPublic = !!sprite.isPublic;
      if (versionIsPublic) group.isPublic = true;
      group.versions.push({
        id: sprite._id,
        version: sprite.version ?? 1,
        updatedAt: sprite.updatedAt,
        // Preserve the original "undefined counts as owned"
        // semantics. After the `isOwner === false` filter above
        // the type is `true | undefined`, so we map `undefined`
        // -> `true` directly without a comparison that TS would
        // flag as always-true.
        isOwner: sprite.isOwner ?? true,
        isPublic: versionIsPublic,
      });
    }
    for (const group of byName.values()) {
      group.versions.sort((a, b) => b.version - a.version);
    }
    // Order: public bundles first, private bundles second. Within
    // each section the relative order matches the LibraryPanel's
    // "newest activity first" list, since `useLibrary` already
    // returns sprites sorted by `updatedAt` desc. We use a stable
    // `Array.prototype.sort` (every modern engine is stable) so
    // the in-section ordering is preserved.
    const allGroups = Array.from(byName.values());
    allGroups.sort((a, b) => {
      if (a.isPublic === b.isPublic) return 0;
      return a.isPublic ? -1 : 1;
    });
    return allGroups;
  }, [sprites]);

  function handlePaste(target: Target) {
    if (busy) return;
    // Close the modal as soon as the user picks a target so the
    // parent's Preview/Undo toast can appear on a clean canvas.
    // We snapshot the per-target busy state for visual feedback
    // while the parent does the actual paste in the background.
    if (target.kind === "workspace") {
      setBusyTarget("workspace");
      onPasteIntoWorkspace(icons);
      onClose();
      return;
    }
    setBusyTarget(target.id);
    onPasteIntoLibraryVersion({
      spriteId: target.id,
      bundleName: target.bundleName,
      version: target.version,
      icons,
    });
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => undefined : onClose}
      maxWidth="max-w-md"
      ariaLabel="Paste icons into"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </span>
            <h3 className="text-sm font-bold text-slate-900">
              Paste{" "}
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">
                {icons.length}
              </span>{" "}
              Icons To...
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Close paste dialog"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="custom-scrollbar mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {/* Current workspace target — always first. */}
          <button
            type="button"
            onClick={() => handlePaste({ kind: "workspace" })}
            disabled={busy}
            className="group flex w-full items-center justify-between rounded-xl border-2 border-indigo-100 bg-indigo-50/30 p-4 text-left transition-all hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
          >
            <div>
              <h4 className="text-sm font-bold text-indigo-600">
                Current Workspace
              </h4>
              <p className="text-[11px] text-slate-500">
                Paste into your staging area
              </p>
            </div>
            <span className="rounded-lg bg-indigo-100 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 transition-colors group-hover:bg-indigo-600 group-hover:text-white">
              {busyTarget === "workspace" ? "Pasting…" : "Paste Here"}
            </span>
          </button>

          {!currentUser && (
            <p className="py-3 text-center text-[11px] text-slate-500">
              Sign in to paste into a saved library.
            </p>
          )}

          {currentUser && loading && groups.length === 0 && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton-shimmer h-16 rounded-xl" />
              ))}
            </div>
          )}

          {currentUser && !loading && groups.length === 0 && (
            <p className="py-4 text-center text-[11px] text-slate-500">
              No saved libraries yet.
            </p>
          )}

          {currentUser &&
            groups.map((group) => (
              <div
                key={group.bundleName}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex gap-4">
                  <h4 className="text-sm font-bold text-slate-800">
                    {group.bundleName}
                  </h4>
                  {group.isPublic && (
                    <span
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600"
                    >
                      <EyeIcon className="h-3 w-3" />
                      Public
                    </span>
                  )}
                  {!group.isPublic && (
                    <span
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-slate-200/70 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                    >
                      <LockIcon className="h-3 w-3" />
                      Private
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-2">
                  {group.versions.map((version) => {
                    const isBusy = busyTarget === version.id;
                    return (
                      <div
                        key={version.id}
                        className="flex items-center justify-between border-l-2 border-indigo-100 pl-3"
                      >
                        <div>
                          <div className="text-xs font-semibold text-slate-700">
                            v{version.version}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {formatDate(version.updatedAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handlePaste({
                              kind: "library",
                              id: version.id,
                              bundleName: group.bundleName,
                              version: version.version,
                            })
                          }
                          disabled={busy}
                          className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50"
                        >
                          {isBusy ? "Pasting…" : "Paste Here"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </Modal>
  );
}
