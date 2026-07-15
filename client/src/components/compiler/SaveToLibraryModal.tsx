// "Save to Organization" modal — opens from the live demo's
// "Save to Library" button. Lets the user pick a library name and
// a version description, then dispatches the save through the
// supplied `onSubmit` callback. The parent (Compiler) is
// responsible for hitting the API and refetching the library list.
//
// Important contract:
//   - "Library Name" is the bundleName — the grouping key used by
//     the server to find the latest version under a given bundle.
//   - "Version Description" is a free-form human label for this
//     specific save. It is NOT appended to the bundle name; the
//     server auto-numbers versions per bundle.
import { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";

type SaveToLibraryModalProps = {
  isOpen: boolean;
  busy: boolean;
  /** Names of libraries that already exist (for live conflict hint). */
  existingNames: string[];
  defaultName: string;
  /**
   * Hint shown inside the Library Name field when it's empty
   * (e.g. "New sprite 7/15/2026"). When the user submits an empty
   * value the parent falls back to this string so the save still
   * succeeds.
   */
  placeholder?: string;
  /**
   * The next version number the server will assign if the user
   * saves against the `defaultName` bundle. We pre-fill the
   * Version Description with this so the user sees a sensible
   * default (e.g. "v3") every time the modal opens.
   */
  nextVersion: number;
  /**
   * Initial value of the "Make it as public" toggle. Defaults to
   * `false` (private) when the modal is opened for a new bundle,
   * and is seeded from the existing library's visibility when the
   * modal is opened to save a new version of a bundle the user
   * already loaded (matches the main page's inline-save toggle).
   */
  initialIsPublic?: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; version: string; isPublic: boolean }) => void;
};

export default function SaveToLibraryModal({
  isOpen,
  busy,
  existingNames,
  defaultName,
  placeholder,
  nextVersion,
  initialIsPublic = false,
  onClose,
  onSubmit,
}: SaveToLibraryModalProps) {
  const [name, setName] = useState(defaultName);
  const [version, setVersion] = useState(`v${nextVersion}`);
  // Local mirror of the public toggle. Seeded from
  // `initialIsPublic` on every open so the user can flip the
  // visibility per-save without it leaking across opens.
  const [isPublic, setIsPublic] = useState<boolean>(initialIsPublic);

  // Pre-fill the inputs every time the modal is (re)opened. The
  // `defaultName` and `nextVersion` props may change between opens
  // (the user could have saved another version in the meantime),
  // so we sync the local state from the props here.
  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setVersion(`v${nextVersion}`);
      setIsPublic(initialIsPublic);
    }
  }, [isOpen, defaultName, nextVersion, initialIsPublic]);

  const trimmedName = name.trim();
  const trimmedVersion = version.trim();
  const isNameConflict = useMemo(
    () =>
      trimmedName.length > 0 &&
      existingNames.some(
        (existing) => existing.trim().toLowerCase() === trimmedName.toLowerCase(),
      ),
    [trimmedName, existingNames],
  );
  // The form is invalid only when the user typed a conflicting
  // name. An empty field is allowed — the parent will use the
  // placeholder (or `defaultName`) as the actual bundle name.
  const isInvalid = isNameConflict || trimmedVersion.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => undefined : onClose}
      maxWidth="max-w-md"
      ariaLabel="Save to organization library"
    >
      <div className="p-6">
        <h3 className="text-base font-bold text-slate-900">Save to Organization</h3>
        <p className="mt-1 text-xs text-slate-500">
          Save this sprite to the shared Syncfusion library.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="save-library-name"
              className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500"
            >
              Library Name
            </label>
            <input
              id="save-library-name"
              type="text"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder={placeholder ?? "eg. Bolddesk icons"}
              className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 ${
                isNameConflict
                  ? "border-rose-500 focus:ring-rose-500"
                  : "border-slate-200 focus:ring-indigo-500"
              }`}
            />
            {isNameConflict && (
              <p className="mt-1 text-[11px] font-medium text-rose-500">
                A library with this name already exists. Pick a different name
                to create a new bundle.
              </p>
            )}
            {!isNameConflict && trimmedName.length === 0 && placeholder && (
              <p className="mt-1 text-[11px] text-slate-400">
                Leave empty to use the suggested name “{placeholder}”.
              </p>
            )}
            {!isNameConflict && trimmedName.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-400">
                New versions of “{trimmedName}” will be grouped under this name.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="save-version-description"
              className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500"
            >
              Version Description
            </label>
            <input
              id="save-version-description"
              type="text"
              value={version}
              disabled={busy}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="v1"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              A label for this save. The server assigns the numeric version
              automatically.
            </p>
          </div>

          {/* "Make it as public" toggle. Mirrors the main page's
              inline-save section so the user gets a consistent
              visibility control whether they save from the
              compiler or from the Live Demo. Default is private
              for new bundles; seeded from the active bundle's
              visibility when the modal opens against an already-
              loaded library. */}
          <div className="border-t border-slate-200/60 pt-3">
            <label className="group flex cursor-pointer items-center gap-2.5">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={isPublic}
                  disabled={busy}
                  onChange={(event) => setIsPublic(event.target.checked)}
                  className="peer sr-only"
                  aria-label="Make this library public"
                />
                <div className="block h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-500 peer-disabled:opacity-60" />
                <div className="dot absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </div>
              <span className="text-sm font-semibold text-slate-700 transition-colors group-hover:text-slate-900">
                Make it as public
              </span>
            </label>
            <p className="mt-1 pl-[44px] text-[11px] text-slate-400">
              {isPublic
                ? "Visible to every signed-in user. Only you can rename or delete it."
                : "Only you can see and access this library."}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ name: trimmedName, version: trimmedVersion, isPublic })}
            disabled={busy || isInvalid}
            className="rounded-lg bg-emerald-600 px-6 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
