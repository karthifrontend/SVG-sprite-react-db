// "Paste Icons To..." modal. Lets the user push selected symbols into a workspace or a library version.
import { useEffect, useMemo } from "react";
import Modal from "../Modal";
import { useLibrary } from "../../hooks/useLibrary";
import { useAuth } from "../../context/AuthContext";
import type { CopiedIcon } from "./LiveDemo";
import VisibilityBadge from "../VisibilityBadge";

type PasteIconsModalProps = {
  isOpen: boolean;
  icons: CopiedIcon[];
  busy: boolean;
  onClose: () => void;
  // Optional name of the library the user is currently editing in the live demo. When set, the bundle with this name is hidden from the target list so the user can't accidentally paste the icons back into the very same library and create a duplicate version of it.
  currentBundleName?: string;
  // Source library metadata for the icons being pasted. When present, the modal surfaces a "You have copied icons from" header so the user can see which library/version/visibility the icons originated from. When absent, the modal falls back to a generic label.
  sourceInfo?: {
    name: string;
    version?: number;
    isPublic?: boolean;
    isOwner?: boolean;
  };
  // Paste the icons into the compiler's staging area. The modal closes itself immediately after the call returns so the parent's Preview/Undo toast can appear right away.
  onPasteIntoWorkspace: (icons: CopiedIcon[]) => void;
  // Paste the icons into a library. The parent reads the latest version of the bundle, merges the new symbols, and saves a new version. The modal closes itself the moment this is invoked; the parent surfaces its own toast.
  onPasteIntoLibraryVersion: (input: {
    spriteId: string;
    bundleName: string;
    icons: CopiedIcon[];
  }) => void;
};

type Target = { kind: "workspace" } | { kind: "library"; id: string; bundleName: string };

export default function PasteIconsModal({
  isOpen,
  icons,
  busy,
  onClose,
  onPasteIntoWorkspace,
  onPasteIntoLibraryVersion,
  currentBundleName,
  sourceInfo,
}: PasteIconsModalProps) {
  const { currentUser } = useAuth();
  const { sprites, loading, refetch } = useLibrary(!!currentUser);
  useEffect(() => {
    if (isOpen && currentUser) {
      void refetch();
    }
  }, [isOpen, currentUser, refetch]);

  // Group by bundle so the UI can show "Name" with a version count summary. Pasting can only target libraries the signed-in user owns (the library panel only exposes owner-only actions — load, edit, delete, rename — to non-owners, and the public-by-someone-else case is read-only). Foreign public libraries are filtered out here so the popup mirrors the same "owned only" view the user has in the library panel.
  const groups = useMemo(() => {
    const byName = new Map<
      string,
      {
        bundleName: string;
        isPublic: boolean;
        versionCount: number;
        latestId: string;
        latestVersion: number;
        versions: { id: string; version: number; updatedAt?: string; isOwner: boolean; isPublic: boolean }[];
      }
    >();
    // Normalise the current bundle name once so the per-row comparison below is cheap. We lowercase + trim so the match survives incidental whitespace/case differences between the source label the modal receives and the bundle names the server returns.
    const currentKey = currentBundleName?.trim().toLowerCase() || "";
    for (const sprite of sprites) {
      // Skip libraries owned by other users. The server's `listSprites` returns every version of every visible bundle (owner OR public), so we still see foreign public rows in `sprites` and have to drop them here.
      if (sprite.isOwner === false) continue;
      const key = (sprite.bundleName || sprite.name || "").trim();
      if (!key) continue;
      if (currentKey && key.toLowerCase() === currentKey) continue;
      if (!byName.has(key)) {
        byName.set(key, {
          bundleName: sprite.bundleName || sprite.name,
          isPublic: false,
          versionCount: 0,
          latestId: "",
          latestVersion: 0,
          versions: [],
        });
      }
      const group = byName.get(key)!;
      // A bundle is "public" if any of its versions say so. In practice the server keeps the flag consistent across versions, but we OR defensively so a stray miss doesn't hide a real Public badge.
      const versionIsPublic = !!sprite.isPublic;
      if (versionIsPublic) group.isPublic = true;
      const versionNumber = sprite.version ?? 1;
      group.versions.push({
        id: sprite._id,
        version: versionNumber,
        updatedAt: sprite.updatedAt,
        // Preserve the original "undefined counts as owned" semantics. After the `isOwner === false` filter above the type is `true | undefined`, so we map `undefined` -> `true` directly without a comparison that TS would flag as always-true.
        isOwner: sprite.isOwner ?? true,
        isPublic: versionIsPublic,
      });
      // Track the latest version so we can use it as the merge base when the user picks this bundle.
      if (versionNumber > group.latestVersion) {
        group.latestVersion = versionNumber;
        group.latestId = sprite._id;
      }
    }
    for (const group of byName.values()) {
      group.versions.sort((a, b) => b.version - a.version);
      group.versionCount = group.versions.length;
    }
    // Order: public bundles first, private bundles second. Within each section the relative order matches the LibraryPanel's "newest activity first" list, since `useLibrary` already returns sprites sorted by `updatedAt` desc. We use a stable `Array.prototype.sort` (every modern engine is stable) so the in-section ordering is preserved.
    const allGroups = Array.from(byName.values());
    allGroups.sort((a, b) => {
      if (a.isPublic === b.isPublic) return 0;
      return a.isPublic ? -1 : 1;
    });
    return allGroups;
  }, [sprites, currentBundleName]);

  function handlePaste(target: Target) {
    if (busy) return;
    // Close the modal as soon as the user picks a target so the parent's Preview/Undo toast can appear on a clean canvas. We snapshot the per-target busy state for visual feedback while the parent does the actual paste in the background.
    if (target.kind === "workspace") {
      //setBusyTarget("workspace");
      onPasteIntoWorkspace(icons);
      onClose();
      return;
    }
    onPasteIntoLibraryVersion({
      spriteId: target.id,
      bundleName: target.bundleName,
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
      <div className="px-5 pt-4 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex flex-col">
              <h3 className="text-lg font-bold text-slate-900">
                Insert{" "}
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                  {icons.length}
                </span>{" "}
                icons from
              </h3>
              {sourceInfo && (
                <div
                  className="inline-flex text-sm text-slate-500 truncate mt-0 max-w-[200px] gap-1.5 items-center"
                  title={
                    sourceInfo.isPublic
                      ? `Public library: ${sourceInfo.name}`
                      : `Private library: ${sourceInfo.name}`
                  }
                >
                  <span className="max-w-[120px] truncate">{sourceInfo.name}</span>
                  <VisibilityBadge
                    isPublic={!!sourceInfo.isPublic}
                    title=""
                  />
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
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
              {currentBundleName?.trim()
                ? "No other saved libraries to paste into."
                : "No saved libraries yet."}
            </p>
          )}

          {currentUser &&
            groups.map((group) => (
              <div
                key={group.bundleName}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="min-w-0 flex-1 pr-3">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate text-sm font-bold text-slate-800">
                      {group.bundleName}
                    </h4>
                    {group.isPublic && (
                      <VisibilityBadge
                        isPublic={true} title={""}/>
                    )}
                    {!group.isPublic && (
                      <VisibilityBadge
                        isPublic={false} title={""}                      />
                      
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-slate-400">
                    {group.versionCount}{" "}
                    {group.versionCount === 1 ? "version" : "versions"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handlePaste({
                      kind: "library",
                      id: group.latestId,
                      bundleName: group.bundleName,
                    })
                  }
                  disabled={busy}
                  className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50"
                >
                  Paste Here
                </button>
              </div>
            ))}
        </div>
      </div>
    </Modal>
  );
}
