// Side-by-side compare view for a single icon conflict. Modelled after
// the Windows File Explorer "1 File Conflict" popup. The user sees the
// existing icon on the left ("Files already in New Volume (D:)") and the
// newly uploaded icon on the right ("Files from Downloads"), with
// checkboxes on each side to indicate which version(s) to keep. Keeping
// both versions triggers the numeric-suffix rename the user requested
// (the parent supplies the proposed `proposedRename` so the user can
// edit the suffix inline before committing).
import { useEffect, useState } from "react";
import Modal from "../Modal";
import {
  type ConflictResolution,
  type IconConflict,
} from "../../hooks/useSpriteCompiler";
import { CloseIcon } from "../icons";

type IconConflictCompareModalProps = {
  isOpen: boolean;
  conflict: IconConflict | null;
  // The proposed `<base>-<n>` rename suggested by the parent for the
  // "keep both" case. The user can edit it inline; we re-validate
  // against `takenIds` on every keystroke and surface a collision
  // warning if they pick an id that's already in use.
  proposedRename: string;
  // The current resolution for this row (if any), so the modal can
  // seed the two checkboxes to the correct initial state. When the
  // row is already in "both" mode both checkboxes are pre-checked;
  // otherwise only the new-icon checkbox is pre-checked (matching the
  // default "replace" answer the parent modal seeds).
  resolution?: ConflictResolution;
  // Every id that's already taken in the merged sprite — used to
  // detect / reject rename collisions when the user edits the
  // proposed id inline.
  takenIds: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  // Fired when the user clicks "Continue". The compare modal hands
  // back the chosen action — the parent updates the per-row
  // resolution map and closes the compare modal.
  onApply: (input: { kind: "replace" | "skip" | "both"; renamedId: string }) => void;
};

// Bigger preview used in the compare modal so the user can spot
// visual differences between the two versions at a glance.
function ComparePreview({
  viewBox,
  inner,
  label,
}: {
  viewBox: string;
  inner: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="h-24 w-24 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
        <svg
          viewBox={viewBox}
          className="h-20 w-20"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          // Symbol content is trusted because the user uploaded these
          // files themselves in the same session.
          dangerouslySetInnerHTML={{ __html: inner }}
        />
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
    </div>
  );
}

export default function IconConflictCompareModal({
  isOpen,
  conflict,
  proposedRename,
  resolution,
  takenIds,
  busy,
  onClose,
  onApply,
}: IconConflictCompareModalProps) {
  // Two checkboxes — one per side. The user can keep existing only,
  // new only, or both. The "both" case additionally renames the new
  // one with the editable suffix below. We seed from the current
  // resolution so opening the compare modal for a row that's already
  // in "both" mode shows both checkboxes pre-checked (and the user
  // can uncheck one to downgrade to "replace" or "skip").
  const [keepExisting, setKeepExisting] = useState<boolean>(false);
  const [keepNew, setKeepNew] = useState<boolean>(true);
  const [rename, setRename] = useState<string>(proposedRename);

  // Re-seed every time the compare modal opens (or the user switches
  // to a different conflict). The current `resolution` drives the
  // initial checkbox state so the modal is consistent with whatever
  // answer the parent modal already has for the row.
  useEffect(() => {
    if (!isOpen || !conflict) return;
    setKeepExisting(resolution?.kind === "both");
    setKeepNew(true);
    setRename(proposedRename);
  }, [isOpen, conflict, resolution, proposedRename]);

  if (!conflict) return null;

  // The "Continue" button is enabled when the user has picked at
  // least one version to keep. The `takenIds` collision check
  // surfaces as a warning below the rename input — we don't disable
  // Continue for it (the user can still pick "skip" or "replace"
  // without editing the rename), but if the user lands on "keep
  // both" with a colliding id we show a red helper text so they
  // know the rename will fail.
  const hasCollision = keepExisting && keepNew && takenIds.has(rename);
  const canContinue =
    (keepExisting || keepNew) && (!hasCollision || !keepNew || !keepExisting);
  // Combine into a single action. The priority order matches the
  // Windows popup:
  //   • both checked → "both" (with the user's edited rename)
  //   • only new checked → "replace" (default Windows behaviour)
  //   • only existing checked → "skip"
  //   • neither checked → Continue is disabled
  const action: "both" | "replace" | "skip" | null = !keepExisting && !keepNew
    ? null
    : keepExisting && keepNew
      ? "both"
      : keepNew
        ? "replace"
        : "skip";

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => undefined : onClose}
      maxWidth="max-w-md"
      ariaLabel="Compare icon conflict"
    >
      <div className="p-6">
        {/* Header mirrors the Windows "1 File Conflict" subtitle: the
            user is told that "if you select both versions, the copied
            file will have a number added to its name." */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {conflict.id}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              If you select both versions, the new icon will be saved with a
              number added to its name.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close compare"
            className="-mr-1 -mt-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Two-column compare grid. The column headers ("Files from
            Downloads" / "Files already in base sprite") are styled to
            read as captions, just like the Windows popup. */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="compare-keep-existing"
              checked={keepExisting}
              onChange={(event) => setKeepExisting(event.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <label
              htmlFor="compare-keep-existing"
              className="text-[11px] font-bold uppercase tracking-wider text-slate-500 cursor-pointer"
            >
              Existing in base sprite
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="compare-keep-new"
              checked={keepNew}
              onChange={(event) => setKeepNew(event.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <label
              htmlFor="compare-keep-new"
              className="text-[11px] font-bold uppercase tracking-wider text-slate-500 cursor-pointer"
            >
              Newly uploaded
            </label>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col items-center">
            <ComparePreview
              viewBox={conflict.existing.viewBox}
              inner={conflict.existing.inner}
              label="Existing"
            />
            <p
              className="mt-2 text-[10px] font-mono text-slate-400 truncate max-w-full"
              title={conflict.existing.id}
            >
              #{conflict.existing.id}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col items-center">
            <ComparePreview
              viewBox={conflict.incoming.viewBox}
              inner={conflict.incoming.inner}
              label="New"
            />
            <p
              className="mt-2 text-[10px] font-mono text-slate-400 truncate max-w-full"
              title={conflict.incoming.id}
            >
              #{conflict.incoming.id}
            </p>
          </div>
        </div>

        {/* When the user picks "keep both" we show the proposed
            rename with an inline editor so they can override the
            numeric suffix the parent suggested. The collision check
            uses the parent's `takenIds` so the warning is accurate
            even when other "keep both" rows have already claimed
            suffixes. */}
        {action === "both" && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <label
              htmlFor="compare-rename"
              className="block text-[10px] font-bold uppercase tracking-wider text-emerald-700"
            >
              New icon will be saved as
            </label>
            <input
              id="compare-rename"
              type="text"
              value={rename}
              onChange={(event) => setRename(event.target.value)}
              disabled={busy}
              className={`mt-1 w-full rounded-md border bg-white px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-800 focus:outline-none focus:ring-2 ${
                hasCollision
                  ? "border-rose-400 focus:ring-rose-500"
                  : "border-emerald-300 focus:ring-emerald-500"
              }`}
            />
            {hasCollision ? (
              <p className="mt-1.5 text-[11px] font-medium text-rose-600">
                An icon with this id already exists. Pick a different name.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-emerald-700">
                The numeric suffix auto-increments when you keep both for
                multiple conflicts with the same base name.
              </p>
            )}
          </div>
        )}

        {/* Footer mirrors the Windows "Continue" / "Cancel" pair.
            The "Skip" shortcut checkbox from the first popup is
            omitted here because we're already in the per-row compare
            view — the checkboxes above are the per-row equivalent. */}
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!action) return;
              onApply({
                kind: action,
                // Only the "both" branch uses renamedId; the other
                // branches ignore it. We pass the current rename
                // anyway so the parent's resolution map stays
                // well-formed.
                renamedId: rename,
              });
            }}
            disabled={busy || !canContinue}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold border border-indigo-700 shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Applying…" : "Continue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
