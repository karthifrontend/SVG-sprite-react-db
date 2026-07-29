// "Replace or Skip Files" modal. Shown in update mode when the user's
// newly-staged icons contain one or more symbol ids that already live in
// the base sprite. Modelled after the Windows File Explorer "Replace or
// Skip Files" popup that appears when you copy a file onto a destination
// that already has a file with the same name. Each conflicting icon gets
// a row with three actions: Replace (new wins), Skip (existing wins), or
// Compare (open a side-by-side view that lets the user keep both, with
// the new one auto-renamed with a numeric suffix).
import { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import {
  type ConflictResolution,
  type IconConflict,
} from "../../hooks/useSpriteCompiler";
import IconConflictCompareModal from "./IconConflictCompareModal";

type IconConflictModalProps = {
  isOpen: boolean;
  // Every symbol id that exists in BOTH the base sprite and the staged
  // files. The modal renders one row per id.
  conflicts: IconConflict[];
  // `true` while the parent is mid-merge after the user clicks Continue.
  // Disables the footer buttons so the user can't double-submit.
  busy: boolean;
  onClose: () => void;
  // Fired with the per-conflict resolution map when the user clicks
  // Continue. The map is keyed by the conflicting symbol id; every
  // entry is guaranteed to be defined (the modal forces a per-row
  // answer before the Continue button enables).
  onApply: (resolutions: Record<string, ConflictResolution>) => void;
};

// Helper: take a base id and a set of ids that are already taken in the
// merged sprite, and return the next available `<base>-<n>` suffix where
// `<n>` starts at 1 and increments until it finds a free slot. This is
// the same "Files from Downloads" / "Files already in New Volume (D:)"
// "keep both" behaviour from the Windows File Explorer "1 File
// Conflict" popup: the copied file gets a numeric suffix so the two
// versions can coexist.
function nextFreeRenamedId(
  base: string,
  takenIds: ReadonlySet<string>,
): string {
  // Strip any existing trailing `-<n>` so we always start the suffix
  // search from a clean baseline. e.g. "icon-foo-2" → "icon-foo", and
  // the next "keep both" generates "icon-foo-1", "icon-foo-2", etc.,
  // not "icon-foo-2-1", "icon-foo-2-2".
  const stem = base.replace(/-(\d+)$/, "");
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!takenIds.has(candidate)) return candidate;
  }
  // Defensive — should be unreachable for any practical sprite.
  return `${stem}-${Date.now()}`;
}

// Inline-SVG renderer for the per-row preview. We render the symbol's
// inner HTML inside a 48×48 viewport so the user can visually compare
// the two versions without opening the compare modal. The wrapper
// applies the symbol's viewBox so the icon scales correctly regardless
// of its declared viewBox.
function InlineSymbolPreview({
  viewBox,
  inner,
}: {
  viewBox: string;
  inner: string;
}) {
  return (
    <div className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
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
}

export default function IconConflictModal({
  isOpen,
  conflicts,
  busy,
  onClose,
  onApply,
}: IconConflictModalProps) {
  // Per-row resolution state, keyed by the conflicting id. We seed the
  // map with the Windows-Explorer default of "replace" (the highlighted
  // option in the first screenshot) so the modal opens with a sensible
  // answer for every row — the user can still click Skip or Compare on
  // any row to change the answer.
  const [resolutions, setResolutions] = useState<
    Record<string, ConflictResolution>
  >({});
  // The id of the row whose "Compare" button was last clicked — drives
  // the side-by-side compare modal. Only one compare modal at a time.
  const [compareId, setCompareId] = useState<string | null>(null);

  // (Re)seed the resolution map every time the modal (re)opens so a
  // fresh conflict batch always starts with the Windows-explorer
  // "replace" default, regardless of what the user picked in a
  // previous open.
  useEffect(() => {
    if (!isOpen) return;
    const seeded: Record<string, ConflictResolution> = {};
    for (const c of conflicts) seeded[c.id] = { kind: "replace" };
    setResolutions(seeded);
    setCompareId(null);
  }, [isOpen, conflicts]);

  // The conflict currently shown in the side-by-side compare modal.
  // Memoized so opening / closing the compare modal doesn't re-derive.
  const compareConflict = useMemo<IconConflict | null>(() => {
    if (!compareId) return null;
    return conflicts.find((c) => c.id === compareId) ?? null;
  }, [compareId, conflicts]);

  // The id the user is proposing for the "keep both" rename of the
  // currently-compared conflict. Defaults to `<base>-1` (the Windows
  // File Explorer convention), but the user can edit it inline in the
  // compare modal if they want a different suffix.
  const [compareRename, setCompareRename] = useState<string>("");

  // Recompute the proposed rename whenever the compare modal opens or
  // the underlying conflict changes.
  useEffect(() => {
    if (!compareConflict) {
      setCompareRename("");
      return;
    }
    // Pre-compute the set of ids already used in the merged sprite so
    // the proposed rename doesn't collide with an existing symbol. We
    // include every existing-symbol id PLUS every other "keep both"
    // rename the user has already picked in this modal (so two
    // conflicts with the same base id still get distinct suffixes).
    const taken = new Set<string>();
    for (const c of conflicts) taken.add(c.existing.id);
    for (const [id, r] of Object.entries(resolutions)) {
      if (r.kind === "both") taken.add(r.renamedId);
      if (r.kind === "replace") taken.add(id);
    }
    setCompareRename(nextFreeRenamedId(compareConflict.id, taken));
  }, [compareConflict, conflicts, resolutions]);

  // Every row has a resolution picked — required for Continue to be
  // enabled. The seed effect guarantees this, but the check is cheap
  // and protects against a future bug that leaves a row unanswered.
  const allResolved = conflicts.every((c) => !!resolutions[c.id]);

  // All ids that are taken in the merged sprite — used by the compare
  // modal to detect / reject rename collisions if the user edits the
  // proposed id inline. Memoized at the top level (React rules of
  // hooks: no `useMemo` inside JSX).
  const takenIds = useMemo(() => {
    const taken = new Set<string>();
    // Every existing symbol is in `taken` so the proposed rename can
    // never collide with one of the base sprite's symbols.
    for (const c of conflicts) taken.add(c.existing.id);
    // Every "keep both" rename the user has already picked in this
    // modal is also in `taken` so the next proposed rename doesn't
    // collide with a sibling "keep both" for the same base id.
    for (const r of Object.values(resolutions)) {
      if (r.kind === "both") taken.add(r.renamedId);
    }
    return taken;
  }, [conflicts, resolutions]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => undefined : onClose}
      maxWidth="max-w-lg"
      ariaLabel="Replace or skip conflicting icons"
    >
      <div className="p-6">
        {/* Header — mirrors the Windows File Explorer "Replace or Skip
            Files" title. We keep the count in the title so the user
            immediately knows whether this is a 1-icon or many-icon
            conflict (e.g. "Replace or skip 1 icon"). */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Replace or skip {conflicts.length === 1 ? "1 icon" : `${conflicts.length} icons`}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {conflicts.length === 1
                ? "The destination already has an icon with the same name. Pick what to do with the new version."
                : "The destination already has icons with these names. Pick what to do with each new version."}
            </p>
          </div>
        </div>

        {/* Per-conflict rows. Each row shows:
            • the conflicting id (so the user can tell at a glance
              which symbol is affected),
            • an inline preview of the existing icon,
            • an inline preview of the new icon,
            • three actions: Replace / Skip / Compare.
            The selected action is highlighted with the same color
            treatment as the Windows popup — the chosen action is filled
            with a coloured background so the user can scan the column
            and see at a glance which row is in what state. */}
        <div className="mt-5 space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {conflicts.map((conflict) => {
            const resolution = resolutions[conflict.id] ?? {
              kind: "replace",
            };
            return (
              <div
                key={conflict.id}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-mono font-semibold text-slate-700 truncate"
                        title={conflict.id}
                      >
                        {conflict.id}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Existing
                        </span>
                        <InlineSymbolPreview
                          viewBox={conflict.existing.viewBox}
                          inner={conflict.existing.inner}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          New
                        </span>
                        <InlineSymbolPreview
                          viewBox={conflict.incoming.viewBox}
                          inner={conflict.incoming.inner}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setResolutions((prev) => ({
                        ...prev,
                        [conflict.id]: { kind: "replace" },
                      }))
                    }
                    disabled={busy}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      resolution.kind === "replace"
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-600"
                    }`}
                  >
                    {resolution.kind === "replace" && (
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                    Replace the icon in the destination
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setResolutions((prev) => ({
                        ...prev,
                        [conflict.id]: { kind: "skip" },
                      }))
                    }
                    disabled={busy}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      resolution.kind === "skip"
                        ? "border-slate-400 bg-slate-100 text-slate-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                    }`}
                  >
                    {resolution.kind === "skip" && (
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                    Skip this icon
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompareId(conflict.id)}
                    disabled={busy}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      resolution.kind === "both"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-600"
                    }`}
                  >
                    {resolution.kind === "both" && (
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                    Compare info for both icons
                  </button>
                </div>
                {resolution.kind === "both" && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Both kept — new icon will be saved as{" "}
                    <code className="rounded bg-emerald-50 px-1 py-0.5 font-mono font-semibold text-emerald-700">
                      #{resolution.renamedId}
                    </code>
                    .
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer — mirrors the Windows "1 File Conflict" footer with
            a "Skip N files with the same date and size" style row plus
            Continue / Cancel buttons. Since icon files don't have a
            meaningful "date + size" comparison, the skip-all shortcut
            here is phrased as "Skip every conflict" — it sets every
            unanswered / replace answer to "skip" in one click. The
            Continue button applies the current resolution map and
            hands the work back to the parent via `onApply`. */}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              onChange={(event) => {
                if (!event.target.checked) return;
                setResolutions((prev) => {
                  const next = { ...prev };
                  for (const c of conflicts) {
                    next[c.id] = { kind: "skip" };
                  }
                  return next;
                });
              }}
              disabled={busy}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            Skip every conflict
          </label>
          <div className="flex items-center gap-2">
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
                if (!allResolved) return;
                // Force a final pass that defaults any unselected row
                // to "replace" (matches the Windows default) before
                // handing the map to the parent.
                const finalised: Record<string, ConflictResolution> = {};
                for (const c of conflicts) {
                  finalised[c.id] = resolutions[c.id] ?? {
                    kind: "replace",
                  };
                }
                onApply(finalised);
              }}
              disabled={busy || !allResolved}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold border border-indigo-700 shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Applying…" : "Continue"}
            </button>
          </div>
        </div>
      </div>

      <IconConflictCompareModal
        isOpen={!!compareConflict}
        conflict={compareConflict}
        // The compare modal lets the user toggle "keep both" — when
        // they do, we pre-fill the proposed rename with the next free
        // `<base>-<n>` slot. The user can edit the suffix inline; we
        // just hand whatever string they end up with back to the
        // parent resolution map.
        proposedRename={compareRename}
        // The current resolution, so the compare modal can show
        // whether the row is already in "both" mode and let the user
        // undo the "both" choice.
        resolution={compareConflict ? resolutions[compareConflict.id] : undefined}
        // All ids that are taken in the merged sprite — used to
        // detect / reject rename collisions if the user edits the
        // proposed id inline. Computed at the top level of the
        // component to comply with React's rules of hooks (no
        // `useMemo` inside JSX).
        takenIds={takenIds}
        busy={busy}
        onClose={() => setCompareId(null)}
        onApply={({ kind, renamedId }) => {
          if (!compareConflict) return;
          if (kind === "both") {
            setResolutions((prev) => ({
              ...prev,
              [compareConflict.id]: { kind: "both", renamedId },
            }));
          } else if (kind === "skip") {
            setResolutions((prev) => ({
              ...prev,
              [compareConflict.id]: { kind: "skip" },
            }));
          } else {
            setResolutions((prev) => ({
              ...prev,
              [compareConflict.id]: { kind: "replace" },
            }));
          }
          setCompareId(null);
        }}
      />
    </Modal>
  );
}
