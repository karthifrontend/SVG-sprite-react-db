// Side-by-side compare view for a single icon conflict. Modelled after
// the Windows File Explorer "1 File Conflict" popup. The user sees the
// existing icon on the left ("Files already in base sprite") and the
// newly uploaded icon on the right ("Files from uploads"), with
// checkboxes on each side to indicate which version(s) to keep. Both
// checkboxes start UNCHECKED so the user has to make an explicit
// choice per side. When the user picks "keep both", the new icon is
// saved with the parent-supplied auto-suggested `<base>-<n>` suffix
// (no inline editor in this popup — the parent's collision-free
// suffix is used directly, matching the per-row "keep both"
// behaviour in the parent popup).
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
  // "keep both" case. The Compare popup no longer exposes an inline
  // editor — the value is used as-is when the user picks "keep both"
  // and clicks Continue. The parent computes this against the union
  // of every existing sprite id and every other "keep both" rename,
  // so two conflicts with the same base id still get distinct
  // suffixes (-1, -2, …).
  proposedRename: string;
  // The current resolution for this row (if any), so the modal can
  // seed the two checkboxes to the correct initial state. When the
  // row is already in "both" mode both checkboxes are pre-checked;
  // any other resolution state (or no resolution) starts with both
  // checkboxes unchecked.
  resolution?: ConflictResolution;
  // Every id that's already taken in the merged sprite. Kept in
  // the prop signature for backwards compatibility with the
  // parent (the parent still supplies the same prop), but no
  // longer used directly in this popup — the inline rename
  // editor was removed in favour of the parent's auto-suggested
  // `<id>-<n>` suffix.
  takenIds: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  // Fired when the user clicks "Continue". The compare modal hands
  // back the chosen action — the parent updates the per-row
  // resolution map and closes the compare modal.
  onApply: (input: { kind: "replace" | "skip" | "both"; renamedId: string }) => void;
};

// Side-by-side preview used in the compare modal. Sized to match
// the per-row preview in the parent modal (`h-12 w-12` wrapper with
// a `h-9 w-9` inner SVG) so the two popups look visually
// consistent — the user gets the same icon footprint whether they
// pick the side-by-side compare popup (1-conflict case) or the
// per-row checkboxes (N>1 case). The wrapper and inner SVG are
// still scaled the same way (`viewBox` + `preserveAspectRatio`)
// so the icon shape is preserved regardless of the declared
// viewBox. The `label` prop is optional: when omitted (the per-row
// context), only the icon is rendered — matching the per-row
// popup's [checkbox + icon] cell exactly. The icon background is
// `bg-white` (not `bg-slate-50`) to match the per-row preview
// exactly, since the row card already has a `bg-slate-50/40`
// backdrop.
function ComparePreview({
  viewBox,
  inner,
  label,
}: {
  viewBox: string;
  inner: string;
  label?: string;
}) {
  const iconBox = (
    <div className="h-12 w-12 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
      <svg
        viewBox={viewBox}
        className="h-9 w-9"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        // Symbol content is trusted because the user uploaded these
        // files themselves in the same session.
        dangerouslySetInnerHTML={{ __html: inner }}
      />
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
  // `takenIds` is unused since the inline rename editor was removed
  // (the parent supplies the auto-suggested `<id>-<n>` suffix
  // directly via `proposedRename`). Kept in the prop signature for
  // backwards compatibility with the parent's callsite. The leading
  // underscore is a TS convention to acknowledge the unused binding.
  takenIds: _takenIds,
  busy,
  onClose,
  onApply,
}: IconConflictCompareModalProps) {
  // Two checkboxes — one per side. The user can keep existing only,
  // new only, or both. Both checkboxes start UNCHECKED so the user
  // has to make an explicit choice per side. The "both" case uses
  // the parent's `proposedRename` directly (auto-incremented
  // suffix) — there is no inline editor in this popup. We seed
  // from the current resolution so opening the compare modal for a
  // row that's already in "both" mode shows both checkboxes
  // pre-checked (and the user can uncheck one to downgrade to
  // "replace" or "skip"); any other resolution state starts with
  // both unchecked.
  const [keepExisting, setKeepExisting] = useState<boolean>(false);
  const [keepNew, setKeepNew] = useState<boolean>(false);

  // Re-seed every time the compare modal opens (or the user switches
  // to a different conflict). The current `resolution` drives the
  // initial checkbox state so the modal is consistent with whatever
  // answer the parent modal already has for the row — matching the
  // per-row popup's tri-state pair exactly:
  //   • `replace`  → source (Files from uploads) on,
  //                  dest (Files already in base sprite) off
  //   • `skip`     → source off, dest on
  //   • `both`     → both on
  //   • undefined  → both off (no decision yet — the per-row
  //                  popup's "no resolution" case, which defaults
  //                  to "skip" on Continue).
  useEffect(() => {
    if (!isOpen || !conflict) return;
    setKeepExisting(
      resolution?.kind === "replace" || resolution?.kind === "both",
    );
    setKeepNew(resolution?.kind === "skip" || resolution?.kind === "both");
  }, [isOpen, conflict, resolution]);

  if (!conflict) return null;

  // The "Continue" button is enabled when the user has picked at
  // least one version to keep. When neither side is checked the
  // button is disabled — the user has to make an explicit choice
  // per side (matching the per-row "unchecked by default"
  // behaviour in the parent modal). The "keep both" branch uses
  // the parent's `proposedRename` directly, so there's no inline
  // collision check here — the parent computes a free
  // `<id>-<n>` suffix against the rest of the merged sprite, and
  // the hook re-validates it on Continue.
  const canContinue = keepExisting || keepNew;
  // Combine into a single action. The priority order matches the
  // Windows popup:
  //   • both checked → "both" (with the parent's auto-suggested
  //     `<id>-<n>` suffix passed through as `renamedId`)
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
      maxWidth="max-w-lg"
      ariaLabel="Compare icon conflict"
      // Per UX request: this stacked modal sits ON TOP of the
      // parent Replace-or-Skip-Files popup, so its close (×)
      // should only dismiss this surface — pressing Escape or
      // clicking the close icon must NOT cascade into the
      // parent conflict popup beneath it. We achieve that by
      //   • `dismissOnBackdrop={false}` — backdrop click does
      //     nothing (already disabled across all icon-conflict
      //     popups).
      //   • `stopEscapePropagation={true}` — Escape calls
      //     `event.stopImmediatePropagation()` after invoking
      //     `onClose`, so the parent modal's own Escape
      //     listener (registered earlier in the DOM) is
      //     suppressed for this keypress.
      // We bump the z-index above the parent's `z-60` so the
      // stacked modal sits visually on top, but otherwise use
      // the same backdrop styling (default `bg-slate-900/60`)
      // and the same `max-w-lg` panel size — so the 1-conflict
      // popup and the N>1 per-row popup have visually
      // identical surfaces.
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
              // Per UX request: closing this modal must NOT cascade
              // into the parent conflict popup beneath it. We stop
              // event propagation so any synthetic bubbling path
              // (or future parent-level listeners we don't yet
              // know about) can't pick up this click. The local
              // `onClose` prop (which clears `compareId` only) is
              // still invoked.
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

        {/* Single row card matching the per-row popup's row style.
            Conflict id at the top, then a 2-column grid of
            [checkbox + icon] pairs. No "EXISTING"/"NEW" label and
            no `#icon-id` caption per side — the per-row popup
            doesn't have those, and removing them keeps the two
            popups visually consistent. */}
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
                viewBox={conflict.incoming.viewBox}
                inner={conflict.incoming.inner}
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
                viewBox={conflict.existing.viewBox}
                inner={conflict.existing.inner}
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
                // Only the "both" branch uses renamedId; the other
                // branches ignore it. We pass the parent's
                // auto-suggested rename directly so the row's
                // caption and the value the hook will use stay
                // in sync — there is no inline editor in this
                // popup.
                renamedId: proposedRename,
              });
            }}
            disabled={busy || !canContinue}
            className="px-4 py-2 rounded-lg bg-linear-to-r from-indigo-600 to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-200/60 transition-all flex items-center gap-1.5 hover:from-indigo-700 hover:to-indigo-600 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
          >
            {busy ? "Applying…" : "Continue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
