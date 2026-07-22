// Staged file list shown below the drop zone. Mirrors the
// "react app with MS" reference: per-row file size, an
// "X files" counter, a "Paste N icons" CTA surfaced by the
// copy flow, an individual remove button (revealed on hover)
// and a clear-all action.
import { formatSize } from "../../utils/sprite";

type StagedFilesListProps = {
  files: File[];
  onClear: () => void;
  onRemove?: (index: number) => void;
  onPasteIcons?: () => void;
  pasteCount?: number;
};

function ImageIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"
      />
    </svg>
  );
}

function ClipboardIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  );
}

function StagedFilesList({
  files,
  onClear,
  onRemove,
  onPasteIcons,
  pasteCount = 0,
}: StagedFilesListProps) {
  if (!files || files.length === 0) return null;

  return (
    <section className="mt-5" aria-label="Staged files">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Staged Files</h2>
        <div className="flex items-center gap-3">
          {onPasteIcons && pasteCount > 0 && (
            <button
              type="button"
              onClick={onPasteIcons}
              className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-600 transition-colors hover:text-emerald-700"
              title="Paste copied icons"
            >
              <ClipboardIcon className="h-3.5 w-3.5" />
              <span>Paste {pasteCount} icons</span>
            </button>
          )}
          <span className="text-xs tabular-nums text-slate-400">
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-rose-400 transition-colors hover:text-rose-600"
            title="Remove all files"
          >
            Clear all
          </button>
        </div>
      </div>
      <div className="custom-scrollbar max-h-52 space-y-1 overflow-y-auto pr-1">
        {files.map((file, index) => (
          <div
            key={`${file.name}-${index}`}
            className="file-item group animate-fade-in-up flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50"
            data-index={index}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                <ImageIcon className="h-8 w-8 text-indigo-500" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-700" title={file.name}>
                  {file.name}
                </p>
                <p className="tabular-nums text-xs text-slate-400">{formatSize(file.size)}</p>
              </div>
            </div>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="file-remove rounded-lg p-1.5 text-slate-400 transition-all duration-150 hover:bg-rose-50 hover:text-rose-500 sm:opacity-0 group-hover:opacity-100"
                title="Remove file"
                aria-label={`Remove ${file.name}`}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default StagedFilesList;
