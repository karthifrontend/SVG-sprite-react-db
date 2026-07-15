type ResultsPanelProps = {
  visible: boolean;
  symbolCount: number;
  spriteUrl: string | null;
  spriteXml: string | null;
  symbolIds: string[];
  copied: boolean;
  onCopy: () => void;
  onDemo: () => void;
  /** Build a zip bundle (sprite + demo.html + preview.png) and
   *  trigger a browser download. Used for the "Download zip" CTA. */
  onDownloadZip: () => void;
  /** Disable the Download zip button while the bundle is being
   *  generated (e.g. preview.png render in flight). */
  downloadBusy?: boolean;
};

function ResultsPanel({
  visible,
  symbolCount,
  spriteUrl,
  spriteXml,
  symbolIds,
  copied,
  onCopy,
  onDemo,
  onDownloadZip,
  downloadBusy,
}: ResultsPanelProps) {
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
          <h2 className="text-base font-bold text-slate-800">Sprite Generated</h2>
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
          <span>{downloadBusy ? "Preparing…" : "Download zip"}</span>
        </button>
      </div>

      {/* Secondary actions: copy + demo */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <button
          type="button"
          onClick={onCopy}
          className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-all duration-150"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          <span>{copied ? "Copied!" : "Copy Sprite"}</span>
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
      </div>

      {/* Symbol IDs */}
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Symbol IDs</p>
        <div className="flex flex-wrap gap-2">
          {symbolIds.length === 0 ? (
            <span className="text-xs text-slate-400">No symbols</span>
          ) : (
            symbolIds.map(id => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-mono text-indigo-700"
              >
                #{id}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Code preview */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-400">sprite.svg</span>
          <button
            type="button"
            onClick={onCopy}
            className="text-xs text-slate-400 hover:text-white font-medium transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            {copied ? "Copied" : "Copy"}
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
