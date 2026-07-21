// Update-mode "Base Sprite File" picker. Mirrors the
// "react app with MS" reference: shows a small drop zone
// (with a "select from library" hint) when no file is picked,
// and an emerald file card with a Change action row once a
// sprite is loaded.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { formatSize } from "../../utils/sprite";

type ExistingSpriteSectionProps = {
  file: File | null;
  /**
   * Optional version number to surface next to the file name
   * when the sprite was loaded from the library. Falls back to
   * `null` (no badge) for uploaded files.
   */
  version?: number | null;
  onFile: (file: File | null) => void;
  onClear: () => void;
  onSelectFromLibrary?: () => void;
  canSelectFromLibrary?: boolean;
  onPreview?: () => void;
};

function CheckCircleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function RefreshIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-3M20 14a8 8 0 01-14 3"
      />
    </svg>
  );
}

function FileUploadIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  );
}

function PlayCircleIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ExistingSpriteSection({
  file,
  version,
  onFile,
  onClear,
  onSelectFromLibrary,
  canSelectFromLibrary,
  onPreview,
}: ExistingSpriteSectionProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isActive, setIsActive] = useState(false);
  const counter = useRef(0);

  function openDialog() {
    inputRef.current?.click();
  }

  function handleFileChosen(picked: File | null | undefined) {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".svg")) {
      onFile(null);
      return;
    }
    onFile(picked);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    handleFileChosen(event.target.files?.[0] ?? null);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    counter.current = 0;
    setIsActive(false);
    handleFileChosen(event.dataTransfer?.files?.[0] ?? null);
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          1. Base Sprite File
        </h2>
      </div>

      {!file && (
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={openDialog}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openDialog();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              counter.current += 1;
              setIsActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              counter.current = Math.max(0, counter.current - 1);
              if (counter.current === 0) setIsActive(false);
            }}
            onDrop={handleDrop}
            className={`cursor-pointer rounded-xl border border-dashed border-slate-300 p-5 text-center transition-all duration-200 hover:border-indigo-400 hover:bg-indigo-50/30 ${
              isActive ? "dropzone-active" : ""
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".svg,image/svg+xml"
              onChange={handleChange}
              className="hidden"
            />
            <FileUploadIcon className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            <p className="text-xs font-medium text-slate-600">
              Upload existing{" "}
              <code className="rounded bg-indigo-50 px-1 py-0.5 font-mono text-indigo-500">
                sprite.svg
              </code>
            </p>
          </div>

          {canSelectFromLibrary && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={onSelectFromLibrary}
                className="text-xs font-medium text-indigo-600 underline underline-offset-2 transition-colors hover:text-indigo-700"
              >
                Or select a sprite from the Library
              </button>
            </div>
          )}
        </div>
      )}

      {file && (
        <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-200 bg-white p-3 text-left shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-500">
              <CheckCircleIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium text-slate-700" title={file.name}>
                  {file.name}
                </p>
                {version != null && (
                  <span
                    className="inline-flex flex-shrink-0 items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-indigo-600"
                    title={`Loaded from library version v${version}`}
                  >
                    v{version}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onPreview && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPreview();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 shadow-sm transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                title="Preview this sprite in the Live Demo"
              >
                <PlayCircleIcon className="h-3.5 w-3.5" />
                Preview
              </button>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClear();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              title="Change base sprite"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              Change
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExistingSpriteSection;
