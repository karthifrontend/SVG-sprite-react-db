import { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import {
  type ConflictResolution,
  type IconConflict,
} from "../../hooks/useSpriteCompiler";
import IconConflictCompareModal from "./IconConflictCompareModal";
import { CloseIcon } from "../icons";

type IconConflictModalProps = {
  isOpen: boolean;
  conflicts: IconConflict[];
  // Every symbol id that already exists in the base sprite. Required
  // for the "keep both" rename to be collision-free against the
  // merged sprite: the rename uses the next free `<base>-<n>` suffix,
  // so the candidate set must include EVERY existing id — not just
  // the conflicting ones from `conflicts` (the conflicting list only
  // contains the ids the staged files collided with, so e.g. an
  // existing `icon-1` that's NOT in the conflict list would still
  // collide with the proposed `icon-1` rename). Without this, the
  // "keep both" path could overwrite an unrelated existing icon.
  existingIds: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  onApply: (resolutions: Record<string, ConflictResolution>) => void;
};

// Source/destination labels shown in the column-header checkboxes of
// the second-image layout. Modelled after the Windows File Explorer
// captions "Files from Downloads" / "Files already in New Volume (D:)".
const SOURCE_LABEL = "Files from uploads";
const DEST_LABEL = "Files already in base sprite";

// Helper: take a base id and a set of ids that are already taken in the
// merged sprite, and return the next available `<base>-<n>` suffix where
// `<n>` starts at 1 and increments until it finds a free slot. Matches
// the Windows "keep both" behaviour — the copied file gets a numeric
// suffix so the two versions can coexist.
function nextFreeRenamedId(
  base: string,
  takenIds: ReadonlySet<string>,
): string {
  const stem = base.replace(/-(\d+)$/, "");
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!takenIds.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}`;
}

// Inline-SVG renderer for the per-row preview. Renders the symbol's
// inner HTML inside a 48×48 viewport so the user can visually compare
// the two versions. The wrapper applies the symbol's viewBox so the
// icon scales correctly regardless of its declared viewBox.
function InlineSymbolPreview({
  viewBox,
  inner,
}: {
  viewBox: string;
  inner: string;
}) {
  return (
    <div className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
      <svg
        viewBox={viewBox}
        className="h-9 w-9"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </div>
  );
}

export default function IconConflictModal({
  isOpen,
  conflicts,
  existingIds,
  busy,
  onClose,
  onApply,
}: IconConflictModalProps) {
  // Per-row resolution state, keyed by the conflicting id. The seed
  // effect resets this map every time the modal (re)opens so a fresh
  // conflict batch always starts from a clean state, regardless of
  // what the user picked in a previous open.
  const [resolutions, setResolutions] = useState<
    Record<string, ConflictResolution>
  >({});
  // The id of the row whose "Compare info" action was last clicked.
  // Drives the side-by-side compare modal. Only one compare modal at
  // a time.
  const [compareId, setCompareId] = useState<string | null>(null);
  // Tracks whether the user has clicked "Let me decide for each
  // icon" to switch from the first-image bulk-action stack to the
  // second-image per-row checkboxes layout. Reset on every open so
  // a fresh conflict batch always starts on the first-image layout.
  // Ignored when there is only one conflict (the single-conflict
  // case always uses the first-image 3-action stack with "Compare
  // info" as the third item).
  const [decidedIndividually, setDecidedIndividually] =
    useState<boolean>(false);
  // Master-checkbox state for the per-row popup. Each master is an
  // independent toggle: the user can check BOTH the "Files from
  // uploads" master AND the "Files already in base sprite" master
  // at the same time (translating to "keep both" for every row on
  // Continue), and un-checking one master does NOT auto-uncheck the
  // other. Both start unchecked on open.
  const [sourceMasterChecked, setSourceMasterChecked] =
    useState<boolean>(false);
  const [destMasterChecked, setDestMasterChecked] =
    useState<boolean>(false);

  // (Re)seed the resolution map every time the modal (re)opens.
  // We leave the map empty by default — every per-row checkbox
  // starts UNCHECKED so the user has to make an explicit choice.
  // Rows the user leaves untouched resolve to "skip" (existing
  // wins) when Continue fires, matching the "no decision → keep
  // existing" semantic that's the safest default for an explicit
  // user-driven merge.
  useEffect(() => {
    if (!isOpen) return;
    setResolutions({});
    setCompareId(null);
    setDecidedIndividually(false);
    setSourceMasterChecked(false);
    setDestMasterChecked(false);
  }, [isOpen, conflicts]);

  // The conflict currently shown in the side-by-side compare modal.
  const compareConflict = useMemo<IconConflict | null>(() => {
    if (!compareId) return null;
    return conflicts.find((c) => c.id === compareId) ?? null;
  }, [compareId, conflicts]);

  // Proposed rename for the "keep both" branch of the currently-opened
  // compare modal. Recomputed every time the compare modal opens or
  // the underlying conflict changes. The `taken` set is built from
  // EVERY existing sprite id (passed in via `existingIds`) plus any
  // "keep both" rename / "replace" decision already on the resolutions
  // map. Using only the conflicting ids here was a bug: when the
  // base sprite has ids like `icon`, `icon-1`, `icon-2` and the user
  // uploads just `icon`, the conflict list only contains `icon`, so
  // `taken` would only hold `icon` and the proposed rename would be
  // `icon-1` — silently overwriting the existing `icon-1`. The fix
  // seeds `taken` with the full set of existing sprite ids so the
  // suffix is collision-free against the entire merged sprite.
  const [compareRename, setCompareRename] = useState<string>("");
  useEffect(() => {
    if (!compareConflict) {
      setCompareRename("");
      return;
    }
    const taken = new Set<string>(existingIds);
    for (const [id, r] of Object.entries(resolutions)) {
      if (r.kind === "both") taken.add(r.renamedId);
      if (r.kind === "replace") taken.add(id);
    }
    setCompareRename(nextFreeRenamedId(compareConflict.id, taken));
  }, [compareConflict, existingIds, resolutions]);

  // All ids that are taken in the merged sprite — used by the compare
  // modal to detect / reject rename collisions if the user edits the
  // proposed id inline. Seeded with the full set of existing sprite
  // ids (not just the conflicting ones) for the same reason as
  // `compareRename` above: the merged sprite is the union of every
  // existing symbol + every "keep both" rename + every "replace" /
  // genuinely-new staged file, so the candidate-free set must
  // include the entire base sprite.
  const takenIds = useMemo(() => {
    const taken = new Set<string>(existingIds);
    for (const r of Object.values(resolutions)) {
      if (r.kind === "both") taken.add(r.renamedId);
    }
    return taken;
  }, [existingIds, resolutions]);

  // ----- SINGLE-CONFLICT HANDLERS -----
  // The first-image single-conflict layout has 3 stacked action
  // items; clicking Replace / Skip applies that decision directly
  // and closes the modal. Clicking Compare opens the side-by-side
  // compare modal for the single conflict.
  const handleSingleReplace = () => {
    if (conflicts.length !== 1) return;
    onApply({ [conflicts[0].id]: { kind: "replace" } });
  };
  const handleSingleSkip = () => {
    if (conflicts.length !== 1) return;
    onApply({ [conflicts[0].id]: { kind: "skip" } });
  };
  const handleSingleCompare = () => {
    if (conflicts.length !== 1) return;
    setCompareId(conflicts[0].id);
  };

  // ----- MULTI-CONFLICT BULK-ACTION HANDLERS (first-image N>1 layout) -----
  // The 3-action stack for N>1 conflicts. Replace-all / Skip-all
  // build a finalised map and hand it straight to the parent's
  // `onApply` — no second confirmation click. "Let me decide for
  // each icon" toggles the modal to the per-row checkboxes layout.
  const handleMultiReplaceAll = () => {
    const finalised: Record<string, ConflictResolution> = {};
    for (const c of conflicts) finalised[c.id] = { kind: "replace" };
    onApply(finalised);
  };
  const handleMultiSkipAll = () => {
    const finalised: Record<string, ConflictResolution> = {};
    for (const c of conflicts) finalised[c.id] = { kind: "skip" };
    onApply(finalised);
  };

  // ----- PER-ROW CHECKBOX HANDLERS (second-image N>1 layout) -----
  // The master checkboxes are INDEPENDENT toggles. Each one
  // controls a single side (source / dest) for every row, and
  // un-checking one master does NOT affect the other. The two
  // handlers below are pure side-setters: handleBulkSource sets the
  // source side for every row, preserving the dest side the user
  // has already picked (or the dest master has set). handleBulkDest
  // does the mirror. When both masters are checked simultaneously,
  // every row ends up in the "keep both" state (both sides on →
  // kind: "both" with the collision-free suffix).
  const handleBulkSource = (on: boolean) => {
    setResolutions((prev) => {
      const next = { ...prev };
      for (const c of conflicts) {
        const destOn =
          next[c.id]?.kind === "skip" || next[c.id]?.kind === "both";
        if (on && destOn) {
          next[c.id] = buildKeepBothFor(c.id);
        } else if (on) {
          next[c.id] = { kind: "replace" };
        } else if (destOn) {
          next[c.id] = { kind: "skip" };
        } else {
          // Both sides off — drop the resolution entirely so the
          // row returns to the "no decision" state. Rows without
          // a resolution default to "skip" on Continue.
          delete next[c.id];
        }
      }
      return next;
    });
  };
  const handleBulkDest = (on: boolean) => {
    setResolutions((prev) => {
      const next = { ...prev };
      for (const c of conflicts) {
        const sourceOn =
          next[c.id]?.kind === "replace" || next[c.id]?.kind === "both";
        if (on && sourceOn) {
          next[c.id] = buildKeepBothFor(c.id);
        } else if (on) {
          next[c.id] = { kind: "skip" };
        } else if (sourceOn) {
          next[c.id] = { kind: "replace" };
        } else {
          // Both sides off — drop the resolution entirely so the
          // row returns to the "no decision" state.
          delete next[c.id];
        }
      }
      return next;
    });
  };
  // Legacy handler kept for the per-row body's existing call
  // sites. Clears every row's resolution (no decision) — used when
  // the user un-checks a master that previously set every row to a
  // single kind and there's no per-row override to preserve.
  const handleUncheckAll = () => {
    setResolutions((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      return {};
    });
  };

  // Build a "keep both" resolution for the given conflict id, picking
  // the next free `<id>-<n>` suffix against the union of EVERY
  // existing sprite id and every other "keep both" / "replace"
  // rename the user has already picked. Seeded with `existingIds`
  // (not just `conflicts`) for the same reason as `compareRename`
  // above — the merged sprite is the union of every base-sprite
  // symbol + every "keep both" rename, so the suffix must be free
  // against the entire base sprite, not just the conflicting ids.
  // The per-row view fires this when the user checks both per-side
  // checkboxes, so the auto-suggested suffix is collision-free from
  // the moment it lands in the resolutions map — and the row's
  // "keep both → #<id>" caption stays consistent with the value the
  // hook will use on Continue.
  const buildKeepBothFor = (id: string): ConflictResolution => {
    const taken = new Set<string>(existingIds);
    for (const [rid, r] of Object.entries(resolutions)) {
      if (rid === id) continue;
      if (r.kind === "both") taken.add(r.renamedId);
      if (r.kind === "replace") taken.add(rid);
    }
    return { kind: "both", renamedId: nextFreeRenamedId(id, taken) };
  };

  // Continue is enabled only when the user has made at least one
  // explicit selection. We track this by checking the resolutions
  // map: if any row has any decision (replace / skip / both) the
  // user has interacted with the grid, otherwise every row is
  // still in the "no decision" default state and Continue should
  // be disabled to nudge them to pick a side. The footer "Skip
  // every conflict" shortcut populates the map for every row
  // (so it counts as a selection too), as does the "Replace all"
  // master checkbox. When the user has not checked anything the
  // resolutions map is empty and `anySelection` is false.
  const anySelection = Object.keys(resolutions).length > 0;

  return (
    <Modal
      isOpen={isOpen}
      // Closing the modal bails the whole generate — no state changes
      // happen while the modal is open. While the parent is mid-merge
      // (`busy`) the backdrop click is suppressed so the user can't
      // dismiss mid-flight.
      onClose={busy ? () => undefined : onClose}
      maxWidth="max-w-lg"
      ariaLabel="Replace or skip conflicting icons"
      // Per UX request: the icon-conflict popup should not dismiss
      // when the user clicks the backdrop — only the explicit
      // close (×) affordance or Cancel button does. This prevents
      // an accidental outside-click from burning the entire
      // conflict-resolution batch when the user is mid-decision.
      dismissOnBackdrop={false}
    >
      <div className="p-6">
        {/* Header — mirrors the Windows File Explorer "1 File
            Conflict" / "N File Conflicts" title. The subtitle is
            the standard Windows "if you select both versions, the
            copied file will have a number added to its name" line
            that explains the "keep both" rename behaviour. The
            close icon (X) at the top-right cancels the whole flow,
            matching the X button in the Windows popup. The title
            text stays in sync with the conflict count. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">
              {conflicts.length === 1
                ? "1 File Conflict"
                : `${conflicts.length} File Conflicts`}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              If you select both versions, the copied file will have a
              number added to its name.
            </p>
          </div>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            aria-label="Close"
            title="Cancel and don't change the sprite"
            className="-mr-1 -mt-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* BODY — always renders the first-image 3-action stack.
            For the 1-conflict case the third button opens the
            stacked IconConflictCompareModal (handled below). For
            the N>1 case the third button ("Let me decide for each
            icon") opens the stacked IconConflictPerRowModal
            instead of swapping the body in-place — the
            first-image popup stays open underneath, and the
            per-row popup is a separate surface on top, matching
            the Windows File Explorer "Replace or Skip Files"
            → "let me decide per file" two-popup flow. */}
        {conflicts.length === 1 ? (
          <ConflictActionStack
            count={1}
            mode="single"
            busy={busy}
            onReplace={handleSingleReplace}
            onSkip={handleSingleSkip}
            onThird={handleSingleCompare}
          />
        ) : (
          <ConflictActionStack
            count={conflicts.length}
            mode="multi"
            busy={busy}
            onReplace={handleMultiReplaceAll}
            onSkip={handleMultiSkipAll}
            onThird={() => setDecidedIndividually(true)}
          />
        )}
      </div>

      {/* Stacked per-row modal — reached via "Let me decide for
          each icon" in the N>1 first-image layout. Sits on top
          of the parent popup (z-[70] vs z-60) with its own
          header, close (×), master checkboxes, per-row grid,
          and Cancel/Continue footer. Close (×) and Cancel return
          to the first-image layout by clearing `decidedIndividually`
          — they do NOT close the whole flow. Continue commits
          the merge via the parent's onApply. The dismiss-on-
          backdrop and stop-escape-propagation guards match the
          Compare modal's stack pattern so the per-row popup
          behaves as a self-contained surface that doesn't
          cascade into the parent. */}
      <IconConflictPerRowModal
        isOpen={decidedIndividually}
        conflicts={conflicts}
        resolutions={resolutions}
        busy={busy}
        sourceLabel={SOURCE_LABEL}
        destLabel={DEST_LABEL}
        sourceMasterChecked={sourceMasterChecked}
        destMasterChecked={destMasterChecked}
        onSourceMasterChange={(on) => {
          setSourceMasterChecked(on);
          handleBulkSource(on);
        }}
        onDestMasterChange={(on) => {
          setDestMasterChecked(on);
          handleBulkDest(on);
        }}
        anySelection={anySelection}
        onUncheckAll={handleUncheckAll}
        onSetRowResolution={(id, resolution) =>
          setResolutions((prev) => ({ ...prev, [id]: resolution }))
        }
        onClearRowResolution={(id) =>
          setResolutions((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          })
        }
        onKeepBoth={buildKeepBothFor}
        onBack={() => setDecidedIndividually(false)}
        onApply={() => {
          const finalised: Record<string, ConflictResolution> = {};
          for (const c of conflicts) {
            // Rows the user left without an explicit decision
            // default to "skip" (existing wins) — the safest
            // "no new" answer when the user hasn't picked a side.
            finalised[c.id] = resolutions[c.id] ?? { kind: "skip" };
          }
          onApply(finalised);
        }}
      />

      <IconConflictCompareModal
        isOpen={!!compareConflict}
        conflict={compareConflict}
        proposedRename={compareRename}
        resolution={compareConflict ? resolutions[compareConflict.id] : undefined}
        takenIds={takenIds}
        busy={busy}
        onClose={() => setCompareId(null)}
        // Continue in the Compare modal commits the user's choice
        // for the currently-compared row AND finalises the rest of
        // the batch — the parent's `onApply` is what re-merges the
        // sprite and closes every popup. We don't bounce through the
        // parent modal's footer Continue button because the user
        // already made their decision in the compare view; the
        // extra click to "confirm again" on the parent modal is
        // friction the Windows File Explorer popup doesn't add.
        // Any row the user didn't explicitly resolve falls back to
        // the seed default ("replace") — matching the existing
        // footer Continue behaviour.
        onApply={({ kind, renamedId }) => {
          if (!compareConflict) return;
          const finalised: Record<string, ConflictResolution> = {};
          for (const c of conflicts) {
            if (c.id === compareConflict.id) {
              if (kind === "both") {
                finalised[c.id] = { kind: "both", renamedId };
              } else if (kind === "skip") {
                finalised[c.id] = { kind: "skip" };
              } else {
                finalised[c.id] = { kind: "replace" };
              }
            } else {
              finalised[c.id] = resolutions[c.id] ?? { kind: "replace" };
            }
          }
          onApply(finalised);
        }}
      />
    </Modal>
  );
}

// ============================================================================
//  Conflict action stack (first-image layout)
// ============================================================================
// Three stacked action items used by BOTH the single-conflict and the
// multi-conflict first-image layouts. The Windows File Explorer
// "Replace or Skip Files" popup has the same 3-button structure for
// both cases; only the third button's purpose (and therefore its
// label + visual treatment) differs:
//   • `mode="single"` — third button is "Compare info for both
//     icons" (neutral styling, opens the side-by-side compare modal
//     for the single conflict). There is no per-row layout to
//     toggle to when there's only one row.
//   • `mode="multi"`  — third button is "Let me decide for each
//     icon" (highlighted with the indigo selection treatment to
//     mirror the Windows popup's selected-row state). It toggles
//     the modal to the second-image per-row checkboxes layout.
//
// The first two buttons are identical between modes — Replace
// (highlighted as the default Windows selection) and Skip (neutral).
// Their labels pluralise automatically based on `count` so the
// single-conflict case reads "Replace the icon" / "Skip this icon"
// (matching the 1-conflict Windows popup) and the multi case reads
// "Replace the icons" / "Skip these icons".
//
// The 1-conflict case is always reached with `count === 1` (the
// parent only renders this component for `conflicts.length === 1`),
// so the singular copy is preserved exactly. The N>1 case passes
// the real conflict count for natural-language pluralisation.
function ConflictActionStack({
  count,
  mode,
  busy,
  onReplace,
  onSkip,
  onThird,
}: {
  count: number;
  mode: "single" | "multi";
  busy: boolean;
  onReplace: () => void;
  onSkip: () => void;
  onThird: () => void;
}) {
  const isPlural = count > 1;
  const replaceLabel = isPlural
    ? "Replace the icons in the destination"
    : "Replace the icon in the destination";
  const skipLabel = isPlural ? "Skip these icons" : "Skip this icon";
  // The third button's label, leading-icon background, and the
  // border / hover treatment all flip together with the mode so
  // the single-conflict case stays visually neutral ("Compare info"
  // is informational) while the multi-conflict case carries the
  // indigo-selection treatment that the Windows popup uses to mark
  // the "let me decide per row" entry point.
  const thirdLabel =
    mode === "single" ? "Compare info for both icons" : "Let me decide for each icon";
  const thirdBorderClass =
    mode === "single"
      ? "border-slate-200 bg-white hover:bg-slate-50"
      : "border-indigo-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40";
  const thirdIconBgClass =
    mode === "single" ? "bg-slate-100 text-slate-500" : "bg-indigo-50 text-indigo-600";
  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        onClick={onReplace}
        disabled={busy}
        className="group flex w-full items-center gap-3 rounded-md border border-indigo-300 bg-indigo-50/60 px-3 py-2.5 text-left transition-colors hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shrink-0">
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-indigo-700">{replaceLabel}</span>
      </button>
      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        className="group flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-slate-500 shrink-0">
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-slate-700">{skipLabel}</span>
      </button>
      <button
        type="button"
        onClick={onThird}
        disabled={busy}
        className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${thirdBorderClass}`}
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full shrink-0 ${thirdIconBgClass}`}
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </span>
        <span className="text-sm font-semibold text-slate-700">{thirdLabel}</span>
      </button>
    </div>
  );
}

// ============================================================================
//  Per-row checkboxes body (second-image layout, N>1 rows)
// ============================================================================
// Reached via "Let me decide for each icon" in the first-image
// multi-conflict layout. Mirrors the Windows File Explorer
// "3 Total File Conflicts" popup with two key tweaks:
//   • The icon previews are arranged in a single shared 2-column
//     grid that lines up with the master checkbox row above, so the
//     per-row "Files from uploads" preview sits directly under the
//     "FILES FROM UPLOADS" header, and the "Files already in base
//     sprite" preview sits directly under the "FILES ALREADY IN
//     BASE SPRITE" header. The visual column alignment makes it
//     easy to scan rows at a glance.
//   • Checking BOTH per-row checkboxes ("select both versions")
//     is a first-class action in this layout — the new icon is
//     saved with an auto-incremented numeric suffix and the row
//     shows a "keep both → #<id>" caption so the user knows
//     exactly which id will be created. The per-row "Compare info"
//     button is gone — the two previews ARE the compare, and the
//     user can decide per side by checking / unchecking. There is
//     no "Use bulk decision" link either: the only way to leave
//     this layout is the close icon, the Cancel button, or the
//     Continue button in the footer.
//   • Every per-row checkbox starts UNCHECKED. The user has to
//     make an explicit choice per row (or use the master
//     checkboxes / "Skip every conflict" footer shortcut) to
//     affect the merge. Rows the user leaves untouched resolve to
//     "skip" (existing wins) when Continue fires, matching the
//     "no decision → keep existing" semantic that's the safest
//     default for a user-driven merge.
// The footer with the "Skip every conflict" shortcut +
// Continue/Cancel is rendered by the parent.
function PerRowCheckboxesBody({
  conflicts,
  resolutions,
  busy,
  sourceLabel,
  destLabel,
  sourceMasterChecked,
  destMasterChecked,
  onSourceMasterChange,
  onDestMasterChange,
  onSetRowResolution,
  onClearRowResolution,
  onKeepBoth,
}: {
  conflicts: IconConflict[];
  resolutions: Record<string, ConflictResolution>;
  busy: boolean;
  sourceLabel: string;
  destLabel: string;
  sourceMasterChecked: boolean;
  destMasterChecked: boolean;
  onSourceMasterChange: (on: boolean) => void;
  onDestMasterChange: (on: boolean) => void;
  onUncheckAll: () => void;
  onSetRowResolution: (id: string, resolution: ConflictResolution) => void;
  onClearRowResolution: (id: string) => void;
  onKeepBoth: (id: string) => ConflictResolution;
}) {
  return (
    <>
      {/* Master checkboxes. Each master is an INDEPENDENT toggle
          bound to a local boolean — checking the "Files from
          uploads" master does NOT un-check the "Files already in
          base sprite" master, and vice versa. By default both
          masters are un-checked. When the user checks a master,
          the matching side is set for every row (preserving the
          other side if it was already on). When both masters are
          checked simultaneously, every row ends up in the "keep
          both" state — the new icon is saved under a
          collision-free numeric suffix, mirroring the per-row
          "keep both" behaviour. The grid below uses the same
          2-column template as the masters, so the per-row icon
          previews line up directly under their master column. */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label
          className={`flex items-center gap-2 ${
            busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={sourceMasterChecked}
            onChange={(event) => {
              onSourceMasterChange(event.target.checked);
            }}
            disabled={busy}
            className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {sourceLabel}
          </span>
        </label>
        <label
          className={`flex items-center gap-2 ${
            busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={destMasterChecked}
            onChange={(event) => {
              onDestMasterChange(event.target.checked);
            }}
            disabled={busy}
            className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {destLabel}
          </span>
        </label>
      </div>
      {/* Per-conflict rows. Each row uses the same 2-column grid
          template as the master checkboxes above, so the source
          preview sits in column 1 (under "FILES FROM UPLOADS") and
          the destination preview sits in column 2 (under "FILES
          ALREADY IN BASE SPRITE"). The conflict id and the
          "keep both" rename caption span both columns. Per-row
          decisions are encoded as a tri-state pair:
            • source checked, dest unchecked  → replace
            • source unchecked, dest checked  → skip
            • source checked, dest checked    → both (auto-renamed)
            • both unchecked                   → no decision
              (resolves to "skip" on Continue via
              the parent's finaliser)
            This is the same priority order the Windows "select both
            versions" / "select one" / "select neither" semantics
            follow. */}
      <div className="mt-3 max-h-[40vh] overflow-y-auto pr-1 space-y-2">
        {conflicts.map((conflict) => {
          // No implicit default — when the user hasn't touched this
          // row, both per-side checkboxes render unchecked. The
          // resolution is derived from the user's explicit choices
          // only:
          //   • no resolution in the map → both checkboxes off
          //     (the row is "no decision yet" and resolves to
          //     "skip" on Continue via the parent's finaliser).
          //   • kind: "replace"          → source on, dest off
          //   • kind: "skip"             → source off, dest on
          //   • kind: "both"             → both on
          const resolution = resolutions[conflict.id];
          const rowReplace = resolution?.kind === "replace";
          const rowSkip = resolution?.kind === "skip";
          const rowBoth = resolution?.kind === "both";
          return (
            <div
              key={conflict.id}
              className="rounded-xl border border-slate-200 bg-slate-50/40 p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-mono font-semibold text-slate-700 truncate flex-1"
                  title={conflict.id}
                >
                  {conflict.id}
                </span>
                {rowBoth && resolution && resolution.kind === "both" && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    keep both →{" "}
                    <code className="font-mono">#{resolution.renamedId}</code>
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
                    checked={rowReplace || rowBoth}
                    onChange={(event) => {
                      if (event.target.checked) {
                        // Source on:
                        //   • dest already on → "both" with a
                        //     collision-free suffix (parent picks
                        //     it so the row caption matches the
                        //     value the hook will use).
                        //   • dest off        → "replace".
                        if (rowSkip) {
                          onSetRowResolution(conflict.id, onKeepBoth(conflict.id));
                        } else {
                          onSetRowResolution(conflict.id, { kind: "replace" });
                        }
                      } else if (rowBoth) {
                        // Source off while dest is still on → "skip".
                        onSetRowResolution(conflict.id, { kind: "skip" });
                      } else {
                        // Source off, dest also off → drop the
                        // resolution entirely so the row returns
                        // to the "no decision" state. The
                        // parent's finaliser on Continue will
                        // default this to "skip" (existing
                        // wins).
                        onClearRowResolution(conflict.id);
                      }
                    }}
                    disabled={busy}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <InlineSymbolPreview
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
                    checked={rowSkip || rowBoth}
                    onChange={(event) => {
                      if (event.target.checked) {
                        // Dest on:
                        //   • source already on → "both" with a
                        //     collision-free suffix.
                        //   • source off        → "skip".
                        if (rowReplace) {
                          onSetRowResolution(conflict.id, onKeepBoth(conflict.id));
                        } else {
                          onSetRowResolution(conflict.id, { kind: "skip" });
                        }
                      } else if (rowBoth) {
                        // Dest off while source is still on → "replace".
                        onSetRowResolution(conflict.id, { kind: "replace" });
                      } else {
                        // Dest off, source also off → drop the
                        // resolution entirely so the row returns
                        // to the "no decision" state.
                        onClearRowResolution(conflict.id);
                      }
                    }}
                    disabled={busy}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <InlineSymbolPreview
                    viewBox={conflict.existing.viewBox}
                    inner={conflict.existing.inner}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ============================================================================
//  Per-row checkboxes modal (second-image layout, stacked on top of
//  the first-image 3-action stack when the user clicks "Let me
//  decide for each icon")
// ============================================================================
// Stacked modal reached via the third button of the N>1 first-image
// layout. Mirrors the `IconConflictCompareModal` stack pattern:
//   • sits at z-[70] above the parent's z-60 so it's visually on
//     top of the first-image 3-action stack underneath
//   • `dismissOnBackdrop={false}` — backdrop click is a no-op
//     (already the convention across all icon-conflict popups)
//   • `stopEscapePropagation={true}` — Escape only dismisses this
//     surface, not the parent popup beneath it
//
// The close (×) icon in the header and the Cancel button in the
// footer both fire `onBack` — which clears the parent's
// `decidedIndividually` flag and returns the user to the
// first-image 3-action stack underneath. They do NOT close the
// whole flow; the parent popup stays open so the user can still
// pick a bulk action (Replace all / Skip all / Let me decide
// again) without re-opening the entire conflict batch.
//
// Continue fires `onApply` with a finalised map: every row
// gets its explicit resolution, and rows the user left
// untouched fall back to "skip" (existing wins) — the same
// "no decision → keep existing" semantic the inline footer
// had before this was extracted into its own modal.
function IconConflictPerRowModal({
  isOpen,
  conflicts,
  resolutions,
  busy,
  sourceLabel,
  destLabel,
  sourceMasterChecked,
  destMasterChecked,
  onSourceMasterChange,
  onDestMasterChange,
  anySelection,
  onUncheckAll,
  onSetRowResolution,
  onClearRowResolution,
  onKeepBoth,
  onBack,
  onApply,
}: {
  isOpen: boolean;
  conflicts: IconConflict[];
  resolutions: Record<string, ConflictResolution>;
  busy: boolean;
  sourceLabel: string;
  destLabel: string;
  sourceMasterChecked: boolean;
  destMasterChecked: boolean;
  onSourceMasterChange: (on: boolean) => void;
  onDestMasterChange: (on: boolean) => void;
  anySelection: boolean;
  onUncheckAll: () => void;
  onSetRowResolution: (id: string, resolution: ConflictResolution) => void;
  onClearRowResolution: (id: string) => void;
  onKeepBoth: (id: string) => ConflictResolution;
  onBack: () => void;
  onApply: () => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      // Closing this stacked modal returns to the first-image
      // layout (via `onBack`), not the whole flow. The parent
      // popup stays open underneath so the user can still pick a
      // bulk action. While the parent is mid-merge (`busy`) the
      // back action is suppressed so the user can't bail
      // mid-flight.
      onClose={busy ? () => undefined : onBack}
      maxWidth="max-w-lg"
      ariaLabel="Decide for each conflicting icon"
      dismissOnBackdrop={false}
      stopEscapePropagation={true}
      zIndexClass="z-[70]"
    >
      <div className="p-6">
        {/* Header — mirrors the parent popup's title block so the
            two stacked popups read as a coherent two-step flow.
            The close (×) icon at the top-right fires `onBack` to
            return to the first-image layout underneath, not to
            close the whole conflict batch. `event.stopPropagation()`
            keeps the click from bubbling into the parent
            popup's own close handler. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">
              {conflicts.length} File Conflicts
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              If you select both versions, the copied file will have a
              number added to its name.
            </p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              // Per UX request: closing this stacked modal must
              // NOT cascade into the parent conflict popup
              // beneath it. We stop event propagation so any
              // synthetic bubbling path can't pick up this
              // click, and call `onBack` to return to the
              // first-image layout.
              event.stopPropagation();
              if (!busy) onBack();
            }}
            disabled={busy}
            aria-label="Back"
            title="Back to bulk actions"
            className="-mr-1 -mt-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Master checkboxes + per-row grid. Reuses the same
            `PerRowCheckboxesBody` layout that used to render
            inline in the parent — extracted into a stacked
            modal so the first-image popup stays visible
            underneath. */}
        <PerRowCheckboxesBody
          conflicts={conflicts}
          resolutions={resolutions}
          busy={busy}
          sourceLabel={sourceLabel}
          destLabel={destLabel}
          sourceMasterChecked={sourceMasterChecked}
          destMasterChecked={destMasterChecked}
          onSourceMasterChange={onSourceMasterChange}
          onDestMasterChange={onDestMasterChange}
          onUncheckAll={onUncheckAll}
          onSetRowResolution={onSetRowResolution}
          onClearRowResolution={onClearRowResolution}
          onKeepBoth={onKeepBoth}
        />

        {/* Footer — mirrors the inline footer that used to
            render in the parent. Cancel returns to the
            first-image layout (via `onBack`); Continue commits
            the merge (via `onApply`). The `event.stopPropagation()`
            calls keep the click from bubbling into the parent
            popup's own close handler. */}
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!busy) onBack();
              }}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (busy || !anySelection) return;
                onApply();
              }}
              disabled={busy || !anySelection}
              title={
                !anySelection
                  ? "Select at least one icon (or check “Skip every conflict”) to enable Continue."
                  : undefined
              }
              className="px-4 py-2 rounded-lg bg-linear-to-r from-indigo-600 to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-200/60 transition-all flex items-center gap-1.5 hover:from-indigo-700 hover:to-indigo-600 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
            >
              {busy ? "Applying…" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
