// Inline "save to library" toggle panel with conflict detection. Sits below the drop zone in create/update modes.
import { useEffect, useState } from "react";
import { InfoIcon } from "../icons/icons";

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
  // True only in update mode AND when the base sprite was loaded from a saved library version. In that case the panel shows the two-toggle UI ("Save new version to library" + "Save as a new library instead") because the user has a known bundle to attach a new version to. When false — i.e. the user uploaded a sprite file from their computer in the update tab — the panel collapses to the single-toggle create-mode UI (no "Save new version" toggle, no "Save as a new library instead" sub-toggle, just "Save to library" with public/private), because an uploaded file has no pre-existing bundle to version off of.
  isLibrarySource?: boolean;
  activeBundleName: string;
  existingLibraryNames: string[];
  value: InlineSaveValue;
  onLibraryNameChange: (next: InlineSaveValue) => void;
  onToggle: (enabled: boolean) => void;
};

function InlineSaveSection({
  isVisible,
  isUpdateMode,
  isLibrarySource,
  activeBundleName,
  existingLibraryNames,
  value,
  onLibraryNameChange,
  onToggle,
}: InlineSaveSectionProps) {
  const [name, setName] = useState(value?.name || "");
  const [isPublic, setIsPublic] = useState<boolean>(value?.isPublic ?? false);

  // `saveAsNew` and `enabled` are now both sourced from the parent's `value` directly — no local mirror. The two toggles encode a single "save to library" intent split across two flags, so we re-derive each toggle's visual state from the same source of truth, which makes the mutual-exclusion behaviour fall out for free (the user can never see "both on" because the parent never holds that state, and the handlers never emit it).

  useEffect(() => {
    if (value?.name !== undefined) setName(value.name);
  }, [value?.name]);

  useEffect(() => {
    if (value?.isPublic !== undefined) setIsPublic(value.isPublic);
  }, [value?.isPublic]);

  if (!isVisible) return null;

  // The two toggles share a single source of truth and are strictly mutually exclusive at the data layer:
  const masterOn = !!value?.enabled && !value?.saveAsNew;
  const newLibraryOn = !!value?.enabled && !!value?.saveAsNew;
  // When the user is in the update tab but uploaded a sprite file from their computer (rather than loading one from the library), there is no pre-existing bundle to version off of, so the two-toggle "new version" UI would be confusing. We collapse the panel to the create-mode UI instead: a single "Save to library" toggle with name input and a public/private visibility option. The two-toggle UI is only shown when we're in update mode AND the base sprite was loaded from the library.
  const renderAsCreateMode = !isUpdateMode || isLibrarySource === false;
  // The "Save as a new library instead" toggle is the master switch for both the name input and the public-visibility toggle in update mode:
  const showNameInput = renderAsCreateMode ? value?.enabled : newLibraryOn;
  const showSaveAsNewToggle = isUpdateMode && isLibrarySource !== false;
  const showPublicOption = renderAsCreateMode ? !!value?.enabled : newLibraryOn;
  const trimmed = name.trim().toLowerCase();
  const activeKey = activeBundleName.trim().toLowerCase();
  const isActiveBundle = trimmed.length > 0 && trimmed === activeKey;
  const hasNameConflict =
    trimmed.length > 0 &&
    existingLibraryNames.includes(trimmed) &&
    !isActiveBundle;
  const toggleLabel = renderAsCreateMode
    ? "Save to library"
    : "Save new version to library";
  const helperText = renderAsCreateMode
    ? "Give this sprite a name so you can find it in the library later."
    : isActiveBundle
      ? "Saving creates the next version of this bundle automatically."
      : "Pick the bundle name to attach this save to.";

  function handleToggle(next: boolean) {
    onToggle?.(next);
    // Master toggle controls "save to library" + picks the "new version" branch by default. Flipping it on forces `saveAsNew` off so the sub-toggle is also off — they can't both be on simultaneously. Flipping it off is the user's "don't save" signal; we leave `saveAsNew` alone in that case so a subsequent click on the sub-toggle still re-enables the save.
    onLibraryNameChange?.({
      name,
      saveAsNew: next ? false : value?.saveAsNew,
      enabled: next,
      hasNameConflict,
      isPublic,
    });
  }

  function handleName(next: string) {
    setName(next);
    onLibraryNameChange?.({
      name: next,
      saveAsNew: value?.saveAsNew,
      enabled: value?.enabled,
      hasNameConflict: false,
      isPublic,
    });
  }

  function handleSaveAsNew(next: boolean) {
    // Sub-toggle is only meaningful in update mode. Clicking it ON implies "save as a new library" — which in our data model is `enabled: true, saveAsNew: true`. Clicking it OFF just clears the `saveAsNew` flag and lets the master toggle (which is still on) take over again.
    if (next) {
      onToggle?.(true);
      onLibraryNameChange?.({
        name,
        saveAsNew: true,
        enabled: true,
        hasNameConflict,
        isPublic,
      });
      return;
    }
    onLibraryNameChange?.({
      name,
      saveAsNew: false,
      enabled: value?.enabled,
      hasNameConflict,
      isPublic,
    });
  }

  function handlePublic(next: boolean) {
    setIsPublic(next);
    onLibraryNameChange?.({
      name,
      saveAsNew: value?.saveAsNew,
      enabled: value?.enabled,
      hasNameConflict,
      isPublic: next,
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      {/* Click target is intentionally narrow: only the toggle pill and the label text trigger the toggle. The rest of the row/card stays inert. The native <label> would have made the whole row clickable, so we bind the click manually on a tight inline-flex wrapper instead. */}
      <div
        className="group inline-flex cursor-pointer items-center gap-3 self-start"
        onClick={() => handleToggle(!masterOn)}
        role="button"
        tabIndex={0}
        aria-pressed={masterOn}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            handleToggle(!masterOn);
          }
        }}
      >
        <div className="relative">
          <input
            type="checkbox"
            checked={masterOn}
            onChange={(event) => handleToggle(event.target.checked)}
            // Suppress the native double-toggle: the checkbox is visually hidden inside a custom div, and we already handle the click on the wrapper above. Letting the input's onChange fire would flip the state twice.
            onClick={(event) => event.stopPropagation()}
            className="peer sr-only"
          />
          <div className="block h-6 w-10 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-600" />
          <div className="dot absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
        </div>
        <div className="text-sm font-semibold text-slate-700 transition-colors group-hover:text-slate-900">
          {toggleLabel}
        </div>
      </div>

      {value?.enabled && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {helperText}
        </p>
      )}

      {showSaveAsNewToggle && (
        <div className="mt-4 border-t border-slate-200/60 pt-3">
          {/* Same narrow click-target treatment as the master toggle: only the pill + label fire the change. The surrounding divider/padding does not. */}
          <div
            className="group inline-flex cursor-pointer items-center gap-3 self-start"
            onClick={() => handleSaveAsNew(!newLibraryOn)}
            role="button"
            tabIndex={0}
            aria-pressed={newLibraryOn}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                handleSaveAsNew(!newLibraryOn);
              }
            }}
          >
            <div className="relative">
              <input
                type="checkbox"
                checked={newLibraryOn}
                onChange={(event) => handleSaveAsNew(event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                className="peer sr-only"
              />
              <div className="block h-6 w-10 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-600" />
              <div className="dot absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <span className="text-sm font-semibold text-slate-700 transition-colors group-hover:text-slate-900">
              Save as a new library instead
            </span>
          </div>
        </div>
      )}

      {showNameInput && (
        <div className="mt-4">
          <label
            htmlFor="library-name"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500"
          >
            Library Name <span className="text-rose-500"><sup>*</sup></span>
          </label>
          <input
            id="library-name"
            type="text"
            value={name}
            onChange={(event) => handleName(event.target.value)}
            placeholder="eg. Bolddesk icons"
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
          {/* Narrow click target again — only the pill + label trigger the public toggle. The info icon's tooltip wrapper is left outside so it doesn't accidentally capture clicks. */}
          <div
            className="group inline-flex cursor-pointer items-center gap-2.5 self-start"
            onClick={() => handlePublic(!isPublic)}
            role="button"
            tabIndex={0}
            aria-pressed={isPublic}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                handlePublic(!isPublic);
              }
            }}
          >
            <div className="relative">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => handlePublic(event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                className="peer sr-only"
              />
              <div className="block h-6 w-10 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-600" />
              <div className="dot absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <span className="text-sm font-semibold text-slate-700 transition-colors group-hover:text-slate-900">
              Make it public
            </span>
            <span
              className="mt-px group/info relative inline-flex"
              tabIndex={0}
              aria-label="What does public mean?"
              onClick={(event) => event.stopPropagation()}
            >
              <InfoIcon className="h-3.5 w-3.5 cursor-pointer text-slate-400 transition-colors group-hover/info:text-indigo-500" />
              {/* Tooltip — appears on hover/focus so screen readers can discover the explanation via the focusable wrapper. */}
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-center text-[11px] font-medium leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/info:opacity-100 group-focus-within/info:opacity-100"
              >
                If a library is marked as public, it will be visible to all users.
                <span
                  aria-hidden
                  className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900"
                />
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export type { InlineSaveValue };
export default InlineSaveSection;
