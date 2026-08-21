// Right-hand results panel. Shows the generated sprite XML, symbol count, and copy/demo/download actions.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { isSpriteSvgFile } from "../../utils/buildDemo";
import type { ToastType } from "../../context/ToastContext";

type ResultsPanelProps = {
  visible: boolean;
  statusLabel: string;
  symbolCount: number;
  spriteUrl: string | null;
  spriteXml: string | null;
  symbolIds: string[];
  onCopy: () => void;
  onDemo: () => void;
  onAddIcons: (files: File[]) => Promise<void>;
  // Surfaces a toast for file-rejection messages that originate inside the "Add more icons" picker (sprite files, non-SVG files). Routed through the parent so the panel stays a pure presentational component and toasts share the same provider as everything else.
  onShowToast?: (message: string, kind: ToastType) => void;
  addIconDisabled?: boolean;
  // Build a zip bundle (sprite + demo.html + preview.png) and trigger a browser download. Used for the "Download zip" CTA.
  onDownloadZip: () => void;
  // Disable the Download zip button while the bundle is being generated (e.g. preview.png render in flight).
  downloadBusy?: boolean;
};

function ResultsPanel({
  visible,
  statusLabel,
  symbolCount,
  spriteUrl,
  spriteXml,
  symbolIds,
  onCopy,
  onDemo,
  onAddIcons,
  onShowToast,
  addIconDisabled,
  onDownloadZip,
  downloadBusy,
}: ResultsPanelProps) {
  // Independent "Copied" feedback state for the main "Copy Sprite" button and the inline "Copy" inside the code preview. Each tracks its own button so clicking one doesn't flip the other's label (a single shared flag would make both labels change together, which felt misleading).
  const [mainCopied, setMainCopied] = useState(false);
  const [inlineCopied, setInlineCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Local filter for the Symbol IDs list. Shown only when the list is long (more than 10 symbols) so it doesn't add clutter for small sprites, but scales gracefully for libraries with hundreds of icons.
  const [symbolSearch, setSymbolSearch] = useState("");
  // Tracks which symbol id was most recently copied so its chip can flip to a "Copied" checkmark. Single-slot state intentionally — a user copying one id doesn't need to see every previously-copied chip still showing feedback, and a single timer is enough to reset it.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const addIconInputRef = useRef<HTMLInputElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  // Reset the search filter whenever the underlying symbol list changes (e.g. user added more icons, opened a different sprite). Without this, a stale query from a previous build would silently hide the new symbols.
  useEffect(() => {
    setSymbolSearch("");
  }, [symbolIds]);

  // If the currently-marked id disappears from the list (e.g. icons were swapped out), drop the "Copied" state so it can't get stuck on an id that no longer exists.
  useEffect(() => {
    if (copiedId && !symbolIds.includes(copiedId)) {
      setCopiedId(null);
    }
  }, [symbolIds, copiedId]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(event: MouseEvent) {
      const container = menuContainerRef.current;
      if (!container) return;
      if (event.target instanceof Node && container.contains(event.target)) {
        return;
      }
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [menuOpen]);

  async function handleMainCopy() {
    await onCopy();
    setMainCopied(true);
    window.setTimeout(() => setMainCopied(false), 1500);
  }

  // Copy a single symbol id like "#icon-foo" to the clipboard. Falls back to a hidden textarea + execCommand when navigator.clipboard is unavailable (older browsers, non-secure contexts like http://). Errors are surfaced as a toast so the user isn't left wondering why nothing happened.
  async function handleCopyId(id: string) {
    const payload = `#${id}`;
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload);
        copied = true;
      }
    } catch {
      // Fall through to the legacy path below.
    }
    if (!copied) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = payload;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1200);
    } else {
      onShowToast?.("Couldn't copy to clipboard", "error");
    }
  }

  function handleAddIconClick() {
    if (!addIconInputRef.current) return;
    addIconInputRef.current.click();
    setMenuOpen(false);
  }

  async function handleAddIconFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setMenuOpen(false);
      return;
    }
    const fileArray = Array.from(files);
    event.target.value = "";
    setMenuOpen(false);

    const svgOnly = fileArray.filter(
      (file) => file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg"),
    );
    const iconOnly: File[] = [];
    const rejectedNames: string[] = [];
    for (const file of svgOnly) {
      const sprite = await isSpriteSvgFile(file);
      if (sprite) {
        rejectedNames.push(file.name);
        continue;
      }
      iconOnly.push(file);
    }
    const nonSvgCount = fileArray.length - svgOnly.length;
    const rejectedCount = rejectedNames.length + nonSvgCount;
    if (rejectedCount > 0) {
      const message =
        rejectedNames.length > 0
          ? `${rejectedNames.join(", ")} is a sprite sheet, drop standalone icons here`
          : `${nonSvgCount} unsupported file${nonSvgCount === 1 ? "" : "s"} ignored. Only icon SVGs are accepted.`;
      onShowToast?.(message, "warning");
    }
    if (iconOnly.length === 0) {
      return;
    }
    await onAddIcons(iconOnly);
  }

  async function handleInlineCopy() {
    await onCopy();
    setInlineCopied(true);
    window.setTimeout(() => setInlineCopied(false), 1500);
  }

  if (!visible) return null;

  return (
    <section id="results" className="mt-8" aria-label="Generated sprite output">
      {/* Success header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-200 animate-pop-in">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-800">{statusLabel}</h2>
          <p className="text-xs text-slate-400">
            {symbolCount} symbol{symbolCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* Primary actions: download zip */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <button
          type="button"
          onClick={onDownloadZip}
          disabled={!spriteUrl || downloadBusy}
          className={`flex-1 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 px-4 rounded-xl transition-all duration-150 shadow-md ${
            spriteUrl && !downloadBusy ? "" : "pointer-events-none opacity-60"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>{downloadBusy ? "Preparing…" : "Download ZIP"}</span>
        </button>
      </div>

      {/* Secondary actions: copy + demo */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <button
          type="button"
          onClick={() => void handleMainCopy()}
          className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all duration-150"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          <span>{mainCopied ? "Copied" : "Copy Sprite"}</span>
        </button>
         <button
            type="button"
            onClick={onDemo}
            className="flex-1 flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100/80 text-indigo-700 font-medium py-3 px-4 rounded-xl border border-indigo-100 hover:border-indigo-200 transition-all duration-150"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>Live Demo</span>
          </button>
         
          <div className="relative" ref={menuContainerRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              disabled={addIconDisabled}
              className={`h-12 w-12 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-all duration-150 hover:bg-slate-50 ${
                addIconDisabled ? "cursor-not-allowed opacity-60" : ""
              }`}
              aria-label="More options"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {menuOpen && !addIconDisabled && (
              <div className="absolute right-0 top-full z-10 mt-2 w-44 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <button
                  type="button"
                  onClick={handleAddIconClick}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50"
                >
                  Add more icons
                </button>
              </div>
            )}
            <input
              ref={addIconInputRef}
              type="file"
              accept=".svg,image/svg+xml"
              multiple
              className="hidden"
              onChange={handleAddIconFiles}
            />
          </div>
        </div>

      {/* Symbol IDs */}
      <div className="mb-5">
        {(() => {
          // Compute the filtered list once so the header badge, the empty state, and the rendered chips all share one source of truth. A leading "#" is stripped because the chips render as "#icon-foo" while the underlying data is just "icon-foo" — without this, users copy the visible form and then searching for it would silently match nothing.
          const query = symbolSearch.trim().toLowerCase().replace(/^#+/, "");
          const total = symbolIds.length;
          const filtered = query
            ? symbolIds.filter((id) => id.toLowerCase().includes(query))
            : symbolIds;
          const shown = filtered.length;
          return (
            <>
              <div className={`mb-2 flex items-center gap-3 ${symbolIds.length > 10 ? "justify-between" : ""}`}>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Symbol IDs</p>
                  {total > 0 && (
                    <span
                      className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                      aria-label={`${total} symbols`}
                    >
                      <span className="font-mono">{`${total} symbols`}</span>
                    </span>
                  )}
                </div>
                {symbolIds.length > 10 && (
                  <div className="relative w-full max-w-xs">
                    <svg
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                    </svg>
                    <input
                      type="search"
                      value={symbolSearch}
                      onChange={(event) => setSymbolSearch(event.target.value)}
                      placeholder="Search symbol ids…"
                      aria-label="Search symbol ids"
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-700 placeholder-slate-400 transition-colors focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                )}
              </div>
              <div className="max-h-64 overflow-auto custom-scrollbar rounded-lg border border-slate-100 bg-slate-50/50 p-2">
                <div className="flex flex-wrap gap-2">
                  {total === 0 ? (
                    <span className="text-xs text-slate-400">No symbols</span>
                  ) : shown === 0 ? (
                    <span className="text-xs text-slate-400">No symbols match “{symbolSearch.trim()}”</span>
                  ) : (
                    filtered.map((id) => {
                      const isCopied = copiedId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => void handleCopyId(id)}
                          title={`Copy #${id}`}
                          aria-label={`Copy #${id}`}
                          // group + group-hover: reveal the copy icon on hover/focus so the row stays compact and uncluttered, but is fully discoverable on interaction. aria-label ensures screen readers still announce the action even when the icon is hidden.
                          className={`group inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-mono transition-all duration-150 ${
                            isCopied
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:ring-1 hover:ring-indigo-200"
                          }`}
                        >
                          <span>#{id}</span>
                          {isCopied ? (
                            <svg
                              className="h-3 w-3 opacity-100"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth="3"
                              aria-hidden="true"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg
                              className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                            </svg>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Code preview */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-400">sprite.svg</span>
          <button
            type="button"
            onClick={() => void handleInlineCopy()}
            className="text-xs text-slate-400 hover:text-white font-medium transition-colors flex items-center gap-1"
          >
            {inlineCopied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
        <div className="max-h-64 overflow-auto custom-scrollbar">
          <pre className="text-[13px] leading-relaxed text-emerald-300 font-mono whitespace-pre-wrap break-all">
            {spriteXml}
          </pre>
        </div>
      </div>
    </section>
  );
}

export default ResultsPanel;
