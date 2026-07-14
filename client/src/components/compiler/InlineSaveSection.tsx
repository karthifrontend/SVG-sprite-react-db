// Inline "save to library" panel shown below the drop zone.
// Mirrors the "react app with MS" reference: a top-level toggle
// for "save to library", a "Save as new library instead" sub-toggle
// that only appears in update mode, and a name input with live
// conflict detection. When the toggle is on, saving always creates
// a new version of the bundle (server-side), so the user can keep
// iterating on the same sprite without typing a new name.
import { useEffect, useState } from "react";
import { InfoIcon } from "../icons";

type InlineSaveValue = {
  enabled: boolean;
  name: string;
  saveAsNew: boolean;
  hasNameConflict: boolean;
  isPublic: boolean;
};

type InlineSaveSectionProps = {
  isVisible: boolean;
  isUpdateMode: boolean;
  activeBundleName: string;
  existingLibraryNames: string[];
  value: InlineSaveValue;
  onLibraryNameChange: (next: InlineSaveValue) => void;
  onToggle: (enabled: boolean) => void;
};

function InlineSaveSection({
  isVisible,
  isUpdateMode,
  activeBundleName,
  existingLibraryNames,
  value,
  onLibraryNameChange,
  onToggle,
}: InlineSaveSectionProps) {
  const [name, setName] = useState(value?.name || "");
  const [saveAsNew, setSaveAsNew] = useState(value?.saveAsNew || false);
  const [isPublic, setIsPublic] = useState<boolean>(value?.isPublic ?? false);

  useEffect(() => {
    if (value?.name !== undefined) setName(value.name);
  }, [value?.name]);

  useEffect(() => {
    if (value?.saveAsNew !== undefined) setSaveAsNew(value.saveAsNew);
  }, [value?.saveAsNew]);

  useEffect(() => {
    if (value?.isPublic !== undefined) setIsPublic(value.isPublic);
  }, [value?.isPublic]);

  if (!isVisible) return null;

  // In update mode we keep the active bundle's name pre-filled and
  // the "save as new" toggle off by default — saving will create
  // a new version of the same bundle automatically.
  const showNameInput = isUpdateMode
    ? value?.enabled && saveAsNew
    : value?.enabled;
  const showSaveAsNewToggle = isUpdateMode && !!value?.enabled;
  const showPublicOption = !!value?.enabled;
  const trimmed = name.trim().toLowerCase();
  const activeKey = activeBundleName.trim().toLowerCase();
  const isActiveBundle = trimmed.length > 0 && trimmed === activeKey;
  const hasNameConflict =
    trimmed.length > 0 &&
    existingLibraryNames.includes(trimmed) &&
    !isActiveBundle;
  const toggleLabel = isUpdateMode
    ? "Save new version to library"
    : "Save to library";
  const placeholder =
    isUpdateMode && activeBundleName
      ? activeBundleName
      : "New Sprite " + new Date().toLocaleDateString();
  const helperText = isUpdateMode
    ? isActiveBundle
      ? "Saving creates the next version of this bundle automatically."
      : "Pick the bundle name to attach this save to."
    : "Give this sprite a name so you can find it in the library later.";

  function handleToggle(next: boolean) {
    onToggle?.(next);
    onLibraryNameChange?.({
      name,
      saveAsNew,
      enabled: next,
      hasNameConflict,
      isPublic,
    });
  }

  function handleName(next: string) {
    setName(next);
    onLibraryNameChange?.({
      name: next,
      saveAsNew,
      enabled: value?.enabled,
      hasNameConflict: false,
      isPublic,
    });
  }

  function handleSaveAsNew(next: boolean) {
    setSaveAsNew(next);
    onLibraryNameChange?.({
      name,
      saveAsNew: next,
      enabled: value?.enabled,
      hasNameConflict,
      isPublic,
    });
  }

  function handlePublic(next: boolean) {
    setIsPublic(next);
    onLibraryNameChange?.({
      name,
      saveAsNew,
      enabled: value?.enabled,
      hasNameConflict,
      isPublic: next,
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <label className="group flex cursor-pointer items-center gap-3">
        <div className="relative">
          <input
            type="checkbox"
            checked={!!value?.enabled}
            onChange={(event) => handleToggle(event.target.checked)}
            className="peer sr-only"
          />
          <div className="block h-6 w-10 rounded-full bg-slate-200 transition-colors peer-checked:bg-emerald-500" />
          <div className="dot absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
        </div>
        <div className="flex-1 text-sm font-semibold text-slate-700 transition-colors group-hover:text-slate-900">
          {toggleLabel}
        </div>
      </label>

      {value?.enabled && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {helperText}
        </p>
      )}

      {showSaveAsNewToggle && (
        <div className="mt-4 border-t border-slate-200/60 pt-3">
          <label className="group flex cursor-pointer items-center gap-3">
            <div className="relative">
              <input
                type="checkbox"
                checked={saveAsNew}
                onChange={(event) => handleSaveAsNew(event.target.checked)}
                className="peer sr-only"
              />
              <div className="block h-6 w-10 rounded-full bg-slate-200 transition-colors peer-checked:bg-emerald-500" />
              <div className="dot absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <span className="text-sm font-semibold text-slate-700 transition-colors group-hover:text-slate-900">
              Save as a new library instead
            </span>
          </label>
        </div>
      )}

      {showNameInput && (
        <div className="mt-4">
          <label
            htmlFor="library-name"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500"
          >
            Library Name
          </label>
          <input
            id="library-name"
            type="text"
            value={name}
            onChange={(event) => handleName(event.target.value)}
            placeholder={placeholder}
            className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 ${
              hasNameConflict
                ? "border-rose-500 focus:ring-rose-500"
                : "border-slate-200 focus:ring-indigo-500"
            }`}
          />
          {hasNameConflict && (
            <p className="mt-1.5 text-xs font-medium text-rose-500">
              A library with this name already exists. Pick a different name.
            </p>
          )}
        </div>
      )}

      {showPublicOption && (
        <div className="mt-4 border-t border-slate-200/60 pt-3">
          <label className="group flex cursor-pointer items-center gap-2.5">
            <div className="relative">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => handlePublic(event.target.checked)}
                className="peer sr-only"
              />
              <div className="block h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-500" />
              <div className="dot absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <span className="text-sm font-semibold text-slate-700 transition-colors group-hover:text-slate-900">
              Make it as public
            </span>
            <span
              className="group/info relative inline-flex"
              tabIndex={0}
              aria-label="What does public mean?"
            >
              <InfoIcon className="h-3.5 w-3.5 cursor-help text-slate-400 transition-colors group-hover/info:text-indigo-500" />
              {/* Tooltip — appears on hover/focus so screen readers can
                  discover the explanation via the focusable wrapper. */}
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-center text-[11px] font-medium leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/info:opacity-100 group-focus-within/info:opacity-100"
              >
                dummy
                <span
                  aria-hidden
                  className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900"
                />
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

export type { InlineSaveValue };
export default InlineSaveSection;
