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
  onClose: () => void;
  onSubmit: (input: { name: string; version: string }) => void;
};

export default function SaveToLibraryModal({
  isOpen,
  busy,
  existingNames,
  defaultName,
  placeholder,
  nextVersion,
  onClose,
  onSubmit,
}: SaveToLibraryModalProps) {
  const [name, setName] = useState(defaultName);
  const [version, setVersion] = useState(`v${nextVersion}`);

  // Pre-fill the inputs every time the modal is (re)opened. The
  // `defaultName` and `nextVersion` props may change between opens
  // (the user could have saved another version in the meantime),
  // so we sync the local state from the props here.
  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setVersion(`v${nextVersion}`);
    }
  }, [isOpen, defaultName, nextVersion]);

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
            onClick={() => onSubmit({ name: trimmedName, version: trimmedVersion })}
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
