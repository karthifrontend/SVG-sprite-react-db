import { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import {
  type ConflictResolution,
  type IconConflict,
} from "../../hooks/useSpriteCompiler";
import IconConflictCompareModal from "./IconConflictCompareModal";
import { CloseIcon } from "../icons";
import { useConflictSpriteHost } from "./conflictSpriteHost";

type IconConflictModalProps = {
  isOpen: boolean;
  conflicts: IconConflict[];
  existingIds: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  onApply: (resolutions: Record<string, ConflictResolution>) => void;
};

// Source/destination labels shown in the column-header checkboxes of the second-image layout. 
const SOURCE_LABEL = "Files from uploads";
const DEST_LABEL = "Files already in base sprite";

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

function InlineSymbolPreview({
  id,
  viewBox,
}: {
  id: string;
  viewBox: string;
}) {
  return (
    <div className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
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
}

export default function IconConflictModal({
  isOpen,
  conflicts,
  existingIds,
  busy,
  onClose,
  onApply,
}: IconConflictModalProps) {
  const [resolutions, setResolutions] = useState<
    Record<string, ConflictResolution>
  >({});
  const [compareId, setCompareId] = useState<string | null>(null);
  const [decidedIndividually, setDecidedIndividually] =
    useState<boolean>(false);
  const [sourceMasterChecked, setSourceMasterChecked] =
    useState<boolean>(false);
  const [destMasterChecked, setDestMasterChecked] =
    useState<boolean>(false);

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

  const takenIds = useMemo(() => {
    const taken = new Set<string>(existingIds);
    for (const r of Object.values(resolutions)) {
      if (r.kind === "both") taken.add(r.renamedId);
    }
    return taken;
  }, [existingIds, resolutions]);

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

  useConflictSpriteHost(
    useMemo(() => {
      const seen = new Set<string>();
      const out: { id: string; viewBox: string; inner: string }[] = [];
      conflicts.forEach((c) => {
        if (!seen.has(c.id + "|in")) {
          seen.add(c.id + "|in");
          out.push({
            id: c.id,
            viewBox: c.incoming.viewBox,
            inner: c.incoming.inner,
          });
        }
        if (!seen.has(c.id + "|ex")) {
          seen.add(c.id + "|ex");
          out.push({
            id: `__dest__${c.id}`,
            viewBox: c.existing.viewBox,
            inner: c.existing.inner,
          });
        }
      });
      return out;
    }, [conflicts]),
  );

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
          delete next[c.id];
        }
      }
      return next;
    });
  };

  const handleUncheckAll = () => {
    setResolutions((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      return {};
    });
  };

  const buildKeepBothFor = (id: string): ConflictResolution => {
    const taken = new Set<string>(existingIds);
    for (const [rid, r] of Object.entries(resolutions)) {
      if (rid === id) continue;
      if (r.kind === "both") taken.add(r.renamedId);
      if (r.kind === "replace") taken.add(rid);
    }
    return { kind: "both", renamedId: nextFreeRenamedId(id, taken) };
  };

  const anySelection = Object.keys(resolutions).length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => undefined : onClose}
      maxWidth="max-w-lg"
      ariaLabel="Replace or skip conflicting icons"
      dismissOnBackdrop={false}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-base text-slate-900 font-semibold">
              {`The base sprite file contains ${conflicts.length} icon${conflicts.length === 1 ? "" : "s"} with the same name${conflicts.length === 1 ? "" : "s"}.`}
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
            finalised[c.id] = resolutions[c.id] ?? { kind: "skip" };
          }
          onApply(finalised);
        }}
      />

      <IconConflictCompareModal
        isOpen={!!compareConflict}
        conflict={compareConflict}
        proposedRename={compareRename}
        resolution={
          compareConflict ? resolutions[compareConflict.id] : undefined
        }
        takenIds={takenIds}
        busy={busy}
        onClose={() => setCompareId(null)}
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
      <div className="mt-3 max-h-[40vh] overflow-y-auto pr-1 space-y-2">
        {conflicts.map((conflict) => {
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
                        if (rowSkip) {
                          onSetRowResolution(conflict.id, onKeepBoth(conflict.id));
                        } else {
                          onSetRowResolution(conflict.id, { kind: "replace" });
                        }
                      } else if (rowBoth) {
                        // Source off while dest is still on → "skip".
                        onSetRowResolution(conflict.id, { kind: "skip" });
                      } else {
                        onClearRowResolution(conflict.id);
                      }
                    }}
                    disabled={busy}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <InlineSymbolPreview
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
                    checked={rowSkip || rowBoth}
                    onChange={(event) => {
                      if (event.target.checked) {
                        if (rowReplace) {
                          onSetRowResolution(conflict.id, onKeepBoth(conflict.id));
                        } else {
                          onSetRowResolution(conflict.id, { kind: "skip" });
                        }
                      } else if (rowBoth) {
                        // Dest off while source is still on → "replace".
                        onSetRowResolution(conflict.id, { kind: "replace" });
                      } else {
                        onClearRowResolution(conflict.id);
                      }
                    }}
                    disabled={busy}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <InlineSymbolPreview
                    id={`__dest__${conflict.id}`}
                    viewBox={conflict.existing.viewBox}
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
      onClose={busy ? () => undefined : onBack}
      maxWidth="max-w-lg"
      ariaLabel="Decide for each conflicting icon"
      dismissOnBackdrop={false}
      stopEscapePropagation={true}
      zIndexClass="z-[70]"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">
              {conflicts.length} File Conflicts
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              If you select both icons, the copied file will have a
              number added to its name.
            </p>
          </div>
          <button
            type="button"
            onClick={(event) => {
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
