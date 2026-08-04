// Side-by-side compare view for a single icon conflict.
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
  proposedRename: string;
  resolution?: ConflictResolution;
  takenIds: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  onApply: (input: { kind: "replace" | "skip" | "both"; renamedId: string }) => void;
};

function ComparePreview({
  id,
  viewBox,
  label,
}: {
  id: string;
  viewBox: string;
  label?: string;
}) {
  // Render via <use href="#conflict-<id>"> against the host
  // mounted by the parent IconConflictModal. The host's
  // <symbol> elements are per-element recoloured so every
  // paintable value reads as `currentColor`; the card's
  // `color="#334155"` attribute drives the actual paint,
  // matching how the LiveDemo + previewPng card renders. This
  // replaces the previous `dangerouslySetInnerHTML` approach
  // that surfaced the raw `fill="#000"` / `stroke="#1C274C"`
  // values as solid black blobs (the bug visible in the
  // conflict popup screenshot).
  const iconBox = (
    <div className="h-12 w-12 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
      <svg
        viewBox={viewBox}
        className="h-9 w-9"
        preserveAspectRatio="xMidYMid meet"
        color="#334155"
        aria-hidden="true"
      >
        <use href={`#conflict-${id}`} />
      </svg>
    </div>
  );
  if (!label) return iconBox;
  return (
    <div className="flex flex-col items-center gap-2">
      {iconBox}
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
  takenIds: _takenIds,
  busy,
  onClose,
  onApply,
}: IconConflictCompareModalProps) {
  const [keepExisting, setKeepExisting] = useState<boolean>(false);
  const [keepNew, setKeepNew] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !conflict) return;
    setKeepExisting(
      resolution?.kind === "replace" || resolution?.kind === "both",
    );
    setKeepNew(resolution?.kind === "skip" || resolution?.kind === "both");
  }, [isOpen, conflict, resolution]);

  if (!conflict) return null;

  const canContinue = keepExisting || keepNew;
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
      maxWidth="max-w-lg"
      ariaLabel="Compare icon conflict"
      dismissOnBackdrop={false}
      stopEscapePropagation={true}
    >
      <div className="p-6">
        {/* Header mirrors the Windows "1 File Conflict" title block.
            The title uses the file count wording, the subtitle tells
            the user that "if you select both versions, the copied
            file will have a number added to its name", and the
            close icon (X) at the top-right cancels the compare view
            and returns to the parent modal — matching the X button
            in the Windows popup. The conflicting icon id is rendered
            inside the row card (like the per-row popup) instead of
            the header so the two popups look visually consistent. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">
              1 File Conflict
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              If you select both versions, the copied file will have a
              number added to its name.
            </p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            disabled={busy}
            aria-label="Close"
            title="Close compare view"
            className="-mr-1 -mt-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Master checkboxes. The column headers ("Files from
            uploads" / "Files already in base sprite") match the
            Windows File Explorer "1 File Conflict" popup and align
            with the per-side checkbox+icon row below. The two
            checkboxes are mutually exclusive: checking the "Files
            from uploads" one unchecks the "Files already in base
            sprite" one — but both can also be checked (which means
            "keep both"). */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label
            className={`flex items-center gap-2 ${
              busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              id="compare-keep-source"
              checked={keepExisting}
              onChange={(event) => setKeepExisting(event.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Files from uploads
            </span>
          </label>
          <label
            className={`flex items-center gap-2 ${
              busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              id="compare-keep-dest"
              checked={keepNew}
              onChange={(event) => setKeepNew(event.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Files already in base sprite
            </span>
          </label>
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-mono font-semibold text-slate-700 truncate flex-1"
              title={conflict.id}
            >
              {conflict.id}
            </span>
            {/* "Keep both" badge — mirrors the per-row popup in
                the N>1 layout. Shown when the user has checked
                BOTH per-side checkboxes in this compare popup, so
                the existing icon stays and the new icon is saved
                under the parent's auto-suggested
                collision-free `<id>-<n>` suffix. The badge uses
                the same emerald styling as the per-row popup so
                the two layouts read as the same decision surface.
                Only renders when the compare modal is open AND
                the user has both sides checked AND the parent has
                supplied a non-empty proposed rename. */}
            {keepExisting && keepNew && proposedRename && (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                keep both →{" "}
                <code className="font-mono">#{proposedRename}</code>
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label
              className={`flex items-center gap-2 ${
                busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={keepExisting}
                onChange={(event) => setKeepExisting(event.target.checked)}
                disabled={busy}
                className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <ComparePreview
                id={conflict.id}
                viewBox={conflict.incoming.viewBox}
              />
            </label>
            <label
              className={`flex items-center gap-2 ${
                busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={keepNew}
                onChange={(event) => setKeepNew(event.target.checked)}
                disabled={busy}
                className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <ComparePreview
                id={`__dest__${conflict.id}`}
                viewBox={conflict.existing.viewBox}
              />
            </label>
          </div>
        </div>

        {/* Footer mirrors the Windows "Continue" / "Cancel" pair.
            The "Skip" shortcut checkbox from the first popup is
            omitted here because we're already in the per-row compare
            view — the checkboxes above are the per-row equivalent.
            There is no inline rename input in this popup: when the
            user picks "keep both" the auto-suggested
            `<base>-<n>` suffix from the parent is used directly,
            matching the per-row "keep both" behaviour in the parent
            popup. The parent computes the suffix against the union
            of every existing sprite id and every other "keep both"
            rename, so two conflicts with the same base id still
            get distinct suffixes (-1, -2, …). */}
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={(event) => {
              // Per UX request: closing this modal must NOT cascade
              // into the parent conflict popup beneath it. We
              // stop event propagation so the Cancel click is
              // scoped to this surface only.
              event.stopPropagation();
              onClose();
            }}
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
                renamedId: proposedRename,
              });
            }}
            disabled={busy || !canContinue}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-200/60 transition-all flex items-center gap-1.5 disabled:cursor-not-allowed disabled:hover:bg-indigo-600 disabled:opacity-50 disabled:shadow-none"
          >
            {busy ? "Applying…" : "Continue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
