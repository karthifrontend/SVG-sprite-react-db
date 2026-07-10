// Live demo modal: opens after a successful compile. Provides:
//   - An icon grid with search, select mode, rename and remove.
//   - A Custom CSS tab with size slider, color picker, gradient
//     builder and a generated CSS snippet.
//   - A Save button that updates the source library in place when
//     the preview was opened from a library entry.
//
// The component is fully self-contained: it receives the sprite XML
// and symbol list, parses/serialises the XML locally, and pushes
// changes back through `onUpdate` (parent state) and the library
// `updateContent` action (persisted save).
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ChangeEvent, ReactNode } from "react";
import {
  CloseIcon,
  SearchIcon,
  DuplicateIcon,
  ClipboardIcon,
  PlayCircleIcon,
  PencilIcon,
  SadFaceIcon,
} from "../icons";
import { useToast } from "../../context/ToastContext";
import { useLibrary } from "../../hooks/useLibrary";
import { copyToClipboard } from "../../utils/formatters";

const SVG_NS = "http://www.w3.org/2000/svg";

type SolidPreset = {
  color: string;
  hex: string;
  swatch: string;
  label: string;
};

type GradientPreset = {
  id: string;
  start: string;
  end: string;
};

type ActiveGradient = {
  start: string;
  end: string;
};

type Source =
  | { type: "library"; id: string; name: string; version?: number }
  | { type: "scratch" };

export type { Source };

type LiveDemoProps = {
  isOpen: boolean;
  onClose: () => void;
  /** The current sprite XML (the same string the Compiler holds). */
  sprite: string | null;
  /** The list of symbol ids in the sprite. */
  symbolIds: string[];
  /** Where the sprite came from — controls whether "Save Changes" is shown. */
  source?: Source;
  /**
   * Fired whenever the user mutates the sprite (rename, delete). The
   * parent is expected to update its own `spriteXml`/`symbolIds`
   * state so the rest of the UI stays in sync.
   */
  onUpdate?: (next: { sprite: string; symbolIds: string[]; hasChanges: boolean }) => void;
  /** Optional callback for "open the regular save modal" (fallback). */
  onOpenSaveModal?: () => void;
  /**
   * Optional callback for "copy the current sprite XML to the
   * clipboard". The parent owns the canonical XML, so we delegate.
   */
  onCopySprite?: () => Promise<boolean> | boolean;
  /**
   * Optional callback invoked when the user clicks "Copy N Selected".
   * Receives the selected icons' raw XML/standalone SVG payloads.
   */
  onCopyIcons?: (icons: CopiedIcon[]) => void;
};

export type CopiedIcon = {
  name: string;
  content: string;
  rawSymbol: string;
};

const SOLID_PRESETS: SolidPreset[] = [
  { color: "text-slate-700", hex: "#334155", swatch: "bg-slate-700", label: "Dark Slate" },
  { color: "text-indigo-600", hex: "#4f46e5", swatch: "bg-indigo-600", label: "Indigo" },
  { color: "text-emerald-600", hex: "#059669", swatch: "bg-emerald-600", label: "Emerald" },
  { color: "text-rose-500", hex: "#f43f5e", swatch: "bg-rose-500", label: "Rose" },
  { color: "text-amber-500", hex: "#f59e0b", swatch: "bg-amber-500", label: "Amber" },
];

const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "sunset", start: "#f43f5e", end: "#fb923c" },
  { id: "ocean", start: "#3b82f6", end: "#2dd4bf" },
  { id: "amethyst", start: "#8b5cf6", end: "#d946ef" },
];

function getDefaultActiveColor(): string {
  return SOLID_PRESETS[0]?.color ?? "text-slate-700";
}

/** Serialise the in-memory `<symbol>` elements into a sprite XML doc. */
function serializeLiveSprite(symbols: Element[]): string {
  const inner = symbols
    .map(s => s.outerHTML)
    .join("\n  ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ` +
    `style="width: 0; height: 0; position: absolute;">\n  <defs>\n  ${inner}\n</defs>\n</svg>`
  );
}

/** Parse the symbol list out of a sprite XML string. */
function parseSpriteSymbols(sprite: string | null): Element[] {
  if (!sprite) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sprite, "image/svg+xml");
    if (doc.querySelector("parsererror")) return [];
    return Array.from(doc.querySelectorAll("symbol"));
  } catch {
    return [];
  }
}

export default function LiveDemoModal({
  isOpen,
  onClose,
  sprite,
  symbolIds,
  source,
  onUpdate,
  onOpenSaveModal,
  onCopySprite,
  onCopyIcons,
}: LiveDemoProps) {
  const { showToast } = useToast();
  const { updateContent } = useLibrary();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectMode, setSelectMode] = useState<boolean>(false);
  const [selectedIcons, setSelectedIcons] = useState<Set<string>>(() => new Set());
  const [displayedSymbolIds, setDisplayedSymbolIds] = useState<string[]>(() => symbolIds ?? []);
  const [activeTab, setActiveTab] = useState<"grid" | "css">("grid");
  const [iconSize, setIconSize] = useState<number>(24);
  const [activeColorClass, setActiveColorClass] = useState<string | null>(getDefaultActiveColor);
  const [activeCustomColor, setActiveCustomColor] = useState<string | null>(null);
  const [activeGradient, setActiveGradient] = useState<ActiveGradient | null>(null);
  const [useGradient, setUseGradient] = useState<boolean>(false);
  const [gradientStart, setGradientStart] = useState<string>(GRADIENT_PRESETS[0].start);
  const [gradientEnd, setGradientEnd] = useState<string>(GRADIENT_PRESETS[0].end);
  const [customColor, setCustomColor] = useState<string>("#ff0055");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [savingChanges, setSavingChanges] = useState<boolean>(false);
  const symbolsRef = useRef<Element[]>([]);

  // Reset transient state whenever the modal opens or the source
  // sprite changes.
  useEffect(() => {
    if (!isOpen) return;
    setSearchTerm("");
    setSelectMode(false);
    setSelectedIcons(new Set());
    setActiveTab("grid");
    setHasChanges(false);
    setRenamingId(null);
    setActiveColorClass(getDefaultActiveColor());
    setActiveCustomColor(null);
    setActiveGradient(null);
    setUseGradient(false);
    setIconSize(24);
  }, [isOpen, sprite, symbolIds]);

  function syncSymbols(nextSymbols: Element[]): void {
    symbolsRef.current = nextSymbols;
    setDisplayedSymbolIds(nextSymbols.map((sym) => sym.getAttribute("id") || "").filter(Boolean));
  }

  // Mirror the latest parsed symbol list so callbacks see fresh data
  // without re-rendering.
  useEffect(() => {
    if (!isOpen) return;
    syncSymbols(parseSpriteSymbols(sprite));
  }, [isOpen, sprite]);

  const filteredIds = useMemo<string[]>(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return displayedSymbolIds;
    return displayedSymbolIds.filter((id) => id.toLowerCase().includes(term));
  }, [displayedSymbolIds, searchTerm]);

  function selectedIconsCount(): number {
    return selectedIcons.size;
  }

  function rebuildSprite(): void {
    const nextIds = symbolsRef.current.map((s) => s.getAttribute("id") || "").filter(Boolean);
    setDisplayedSymbolIds(nextIds);
    const updated = serializeLiveSprite(symbolsRef.current);
    onUpdate?.({
      sprite: updated,
      symbolIds: nextIds,
      hasChanges: true,
    });
    setHasChanges(true);
  }

  function deleteIcon(iconId: string): void {
    if (typeof window !== "undefined" && !window.confirm(`Remove "${iconId}" from this sprite?`)) {
      return;
    }
    syncSymbols(symbolsRef.current.filter((sym) => sym.getAttribute("id") !== iconId));
    rebuildSprite();
    showToast(`Removed #${iconId}`, "success");
    if (symbolsRef.current.length === 0) {
      showToast("All icons removed. The sprite is now empty.", "warning");
    }
  }

  function commitRename(): void {
    if (!renamingId) return;
    const newId = renameValue.trim();
    if (!newId || newId === renamingId) {
      setRenamingId(null);
      return;
    }
    if (symbolsRef.current.some((s) => s.getAttribute("id") === newId)) {
      showToast(`"${newId}" already exists. Choose a different name.`, "error");
      return;
    }
    // Clone the target symbol with the new id (preserves its viewBox
    // + content) instead of mutating attributes on a fresh element.
    syncSymbols(
      symbolsRef.current.map((sym) => {
        if (sym.getAttribute("id") !== renamingId) return sym;
        const clone = sym.cloneNode(true) as Element;
        clone.removeAttribute("id");
        clone.setAttribute("id", newId);
        return clone;
      })
    );
    rebuildSprite();
    showToast(`Renamed #${renamingId} → #${newId}`, "success");
    setRenamingId(null);
  }

  function handleSingleClick(id: string): void {
    if (selectMode) {
      setSelectedIcons((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      const usageCode = `<svg class="w-6 h-6"><use href="#${id}"></use></svg>`;
      void copyToClipboard(usageCode).then((ok) => {
        showToast(
          ok ? `Copied SVG usage code for #${id}` : "Failed to copy to clipboard",
          ok ? "success" : "error"
        );
      });
    }
  }

  async function handleCopySelected(): Promise<void> {
    if (selectedIcons.size === 0) return;
    const copied: CopiedIcon[] = [];
    selectedIcons.forEach((id) => {
      const sym = symbolsRef.current.find((s) => s.getAttribute("id") === id);
      if (!sym) return;
      const viewBox = sym.getAttribute("viewBox") || "0 0 24 24";
      const innerHTML = sym.innerHTML;
      copied.push({
        name: id,
        content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${innerHTML}</svg>`,
        rawSymbol: `<symbol id="${id}" viewBox="${viewBox}">${innerHTML}</symbol>`,
      });
    });
    onCopyIcons?.(copied);
    setSelectedIcons(new Set());
    setSelectMode(false);
  }

  function downloadSingleIcon(id: string): void {
    const sym = symbolsRef.current.find((s) => s.getAttribute("id") === id);
    if (!sym) {
      showToast("Symbol element not found", "error");
      return;
    }
    const viewBox = sym.getAttribute("viewBox") || "0 0 24 24";
    const innerHTML = sym.innerHTML;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${innerHTML}</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Downloaded standalone ${id}.svg`, "success");
  }

  function applyPreset(preset: SolidPreset): void {
    setActiveColorClass(preset.color);
    setActiveCustomColor(null);
    setActiveGradient(null);
    setUseGradient(false);
  }

  function applyCustomColor(hex: string): void {
    setCustomColor(hex);
    setActiveCustomColor(hex);
    setActiveColorClass(null);
    setActiveGradient(null);
    setUseGradient(false);
  }

  function applyGradientPreset(preset: GradientPreset): void {
    setGradientStart(preset.start);
    setGradientEnd(preset.end);
    setUseGradient(true);
    setActiveGradient({ start: preset.start, end: preset.end });
    setActiveColorClass(null);
    setActiveCustomColor(null);
  }

  function handleGradientToggle(checked: boolean): void {
    setUseGradient(checked);
    if (checked) {
      setActiveGradient({ start: gradientStart, end: gradientEnd });
      setActiveColorClass(null);
      setActiveCustomColor(null);
    } else {
      setActiveGradient(null);
      setActiveColorClass(getDefaultActiveColor());
    }
  }

  function handleGradientStart(next: string): void {
    setGradientStart(next);
    if (useGradient) setActiveGradient({ start: next, end: gradientEnd });
  }

  function handleGradientEnd(next: string): void {
    setGradientEnd(next);
    if (useGradient) setActiveGradient({ start: gradientStart, end: next });
  }

  // Inject the active gradient definition into a hidden <svg> in the
  // document body so <use href="#id"> can reference it. The original
  // vanilla app mounted this on the sprite container; we use a
  // dedicated hidden element so demo icons render with the gradient
  // regardless of where the modal is opened from.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const GRAD_ID = "demo-icon-gradient";
    const existing = document.getElementById(GRAD_ID);
    if (!activeGradient) {
      if (existing) existing.remove();
      return;
    }
    let host = document.getElementById("live-demo-gradient-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "live-demo-gradient-host";
      host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      host.appendChild(svg);
      document.body.appendChild(host);
    }
    const svg = host.querySelector("svg");
    if (!svg) return;
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      svg.appendChild(defs);
    }
    defs.innerHTML = "";
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", GRAD_ID);
    grad.setAttribute("x1", "0%");
    grad.setAttribute("y1", "0%");
    grad.setAttribute("x2", "100%");
    grad.setAttribute("y2", "100%");
    const stop1 = document.createElementNS(SVG_NS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", activeGradient.start);
    const stop2 = document.createElementNS(SVG_NS, "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", activeGradient.end);
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
  }, [activeGradient]);

  // Ensure the sprite XML (symbols) is available in the document so
  // <use href="#id"> inside the modal can resolve symbol references.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const HOST_ID = "live-demo-sprite-host";
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
      document.body.appendChild(host);
    }
    // Replace host content with the provided sprite XML (or clear)
    host.innerHTML = sprite ?? "";
    return () => {
      // Remove the host when the modal is closed to avoid leaking defs
      if (!isOpen) {
        const existing = document.getElementById(HOST_ID);
        if (existing) existing.remove();
      }
    };
  }, [isOpen, sprite]);

  // Drop the hidden gradient host when the modal closes so stale
  // gradient defs don't leak between sessions.
  useEffect(() => {
    if (isOpen) return;
    if (typeof document === "undefined") return;
    const host = document.getElementById("live-demo-gradient-host");
    if (host) host.remove();
  }, [isOpen]);

  const cssSnippet = useMemo<string>(() => {
    if (activeGradient) {
      return `.icon-gradient {\n  width: ${iconSize}px;\n  height: ${iconSize}px;\n  --icon-color: url(#demo-icon-gradient);\n}`;
    }
    const preset = SOLID_PRESETS.find((p) => p.color === activeColorClass);
    const hex = activeCustomColor || (preset ? preset.hex : "#334155");
    return `.icon-custom {\n  width: ${iconSize}px;\n  height: ${iconSize}px;\n  color: ${hex};\n}`;
  }, [activeGradient, activeColorClass, activeCustomColor, iconSize]);

  async function handleCopyCss(): Promise<void> {
    const ok = await copyToClipboard(cssSnippet);
    showToast(ok ? "Copied CSS code!" : "Failed to copy", ok ? "success" : "error");
  }

  async function handleCopySprite(): Promise<void> {
    if (!onCopySprite) return;
    const ok = await onCopySprite();
    showToast(
      ok ? "Sprite SVG code copied to clipboard!" : "Failed to copy code",
      ok ? "success" : "error"
    );
  }

  async function handleSaveChanges(): Promise<void> {
    if (!source || source.type !== "library") {
      // Fall back to opening the regular save modal so the user can
      // either save to library (if signed in) or just download.
      onOpenSaveModal?.();
      return;
    }
    if (savingChanges) return;
    setSavingChanges(true);
    try {
      const updated = serializeLiveSprite(symbolsRef.current);
      await updateContent(source.id, updated);
      showToast(`Library "${source.name}" updated successfully!`, "success");
      setHasChanges(false);
    } catch (err) {
      showToast(
        "Failed to save changes: " + (err instanceof Error ? err.message : "Unknown error"),
        "error"
      );
    } finally {
      setSavingChanges(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all duration-300"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden transform transition-all duration-300">
        <div className="flex flex-col border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center justify-between px-6 pt-4 pb-2">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Generated Sprite Live Demo</h3>
              <p className="text-xs text-slate-400">Preview and test your compiled SVG symbols live</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Close demo"
            >
              <CloseIcon className="w-6 h-6" />
            </button>
          </div>
          <div className="flex px-6 gap-4 border-b border-slate-100">
            <button
              type="button"
              onClick={() => setActiveTab("grid")}
              className={`px-1 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === "grid" ? "text-indigo-600 border-indigo-600" : "text-slate-500 hover:text-slate-700 border-transparent"}`}
            >
              Icons Grid
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("css")}
              className={`px-1 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === "css" ? "text-indigo-600 border-indigo-600" : "text-slate-500 hover:text-slate-700 border-transparent"}`}
            >
              Custom CSS
            </button>
          </div>
        </div>

        {activeTab === "grid" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-3.5 bg-slate-50 border-b border-slate-100 text-sm flex-shrink-0">
              <div className="flex-1 relative max-w-md">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <SearchIcon className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search symbol IDs..."
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xs sm:text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={selectMode}
                      onChange={(event) => setSelectMode(event.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="block w-8 h-4 bg-slate-200 rounded-full peer-checked:bg-indigo-500 transition-colors" />
                    <div className="dot absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm" />
                  </div>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider group-hover:text-slate-700 transition-colors">
                    Select Icons
                  </span>
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 custom-scrollbar">
              {filteredIds.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-slate-400">
                  <SadFaceIcon className="w-12 h-12 mb-3 text-slate-300" strokeWidth={1.5} />
                  <span className="text-sm font-medium">No matching symbols found</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
                  {filteredIds.map((id, index) => {
                    const isSelected = selectedIcons.has(id);
                    return (
                      <DemoIconCard
                        key={id}
                        id={id}
                        index={index}
                        symbol={symbolsRef.current.find((sym) => sym.getAttribute("id") === id) ?? null}
                        isSelected={isSelected}
                        iconSize={iconSize}
                        activeColorClass={activeColorClass}
                        activeCustomColor={activeCustomColor}
                        activeGradient={activeGradient}
                        renamingId={renamingId}
                        renameValue={renameValue}
                        setRenameValue={setRenameValue}
                        setRenamingId={setRenamingId}
                        onClick={() => handleSingleClick(id)}
                        onDoubleClick={() => downloadSingleIcon(id)}
                        onDelete={() => deleteIcon(id)}
                        onRenameCommit={commitRename}
                        onRenameCancel={() => setRenamingId(null)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "css" && (
          <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 custom-scrollbar">
            <div className="max-w-2xl mx-auto w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-8 animate-fade-in-up">
              <h4 className="text-lg font-bold text-slate-800 mb-6">Customize CSS Variables</h4>
              <div className="space-y-8">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider w-16">Size:</span>
                  <input
                    type="range"
                    min={16}
                    max={96}
                    value={iconSize}
                    onChange={(event) => setIconSize(Number(event.target.value))}
                    className="h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 flex-1"
                  />
                  <span className="text-sm text-slate-600 font-mono font-bold w-12 text-right">{iconSize}px</span>
                </div>

                <div className="flex flex-col gap-4 mt-2">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider w-16">Solid:</span>
                    <div className={`flex flex-wrap items-center gap-3 ${useGradient ? "opacity-50 pointer-events-none transition-opacity" : ""}`}>
                      {SOLID_PRESETS.map((preset) => (
                        <button
                          key={preset.color}
                          type="button"
                          title={preset.label}
                          onClick={() => applyPreset(preset)}
                          className={`w-8 h-8 rounded-full ${preset.swatch} border border-slate-300 focus:outline-none transition-all active:scale-90 ${
                            activeColorClass === preset.color && !useGradient && !activeCustomColor
                              ? "scale-110 ring-offset-2 ring-indigo-500 ring-2"
                              : ""
                          }`}
                        />
                      ))}
                      <div className="border-l border-slate-200 pl-3 ml-1 h-6 flex items-center">
                        <div
                          className={`relative w-8 h-8 rounded-full overflow-hidden border border-slate-300 shadow-sm transition-all cursor-pointer focus-within:ring-indigo-500 ${
                            activeCustomColor ? "scale-110 ring-offset-2 ring-indigo-500 ring-2" : "ring-2 ring-indigo-500/0"
                          }`}
                          title="Custom Solid Color"
                        >
                          <input
                            type="color"
                            value={customColor}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => applyCustomColor(event.target.value)}
                            className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer w-16">
                      <input
                        type="checkbox"
                        checked={useGradient}
                        onChange={(event) => handleGradientToggle(event.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Grad:</span>
                    </label>
                    <div
                      className={`flex flex-wrap items-center gap-3 ${useGradient ? "" : "opacity-50 pointer-events-none transition-opacity"}`}
                    >
                      <div className="flex items-center gap-3">
                        {GRADIENT_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            title={preset.id}
                            onClick={() => applyGradientPreset(preset)}
                            className="w-8 h-8 rounded-full border border-slate-300 focus:outline-none transition-all hover:scale-110 active:scale-95"
                            style={{ background: `linear-gradient(135deg, ${preset.start}, ${preset.end})` }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 border-l border-slate-200 pl-3 ml-1 h-6">
                        <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-full border border-slate-200 shadow-inner">
                          <span className="text-[10px] font-bold text-slate-500 uppercase ml-1">Start</span>
                          <div className="relative w-6 h-6 rounded-full overflow-hidden border border-slate-300 cursor-pointer">
                            <input
                              type="color"
                              value={gradientStart}
                              onChange={(event) => handleGradientStart(event.target.value)}
                              className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer"
                            />
                          </div>
                          <svg className="w-3 h-3 text-slate-300 mx-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          <span className="text-[10px] font-bold text-slate-500 uppercase">End</span>
                          <div className="relative w-6 h-6 rounded-full overflow-hidden border border-slate-300 cursor-pointer mr-1">
                            <input
                              type="color"
                              value={gradientEnd}
                              onChange={(event) => handleGradientEnd(event.target.value)}
                              className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 w-full overflow-hidden">
                  <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Generated CSS Code</h5>
                  <div className="relative group w-full overflow-hidden rounded-lg">
                    <pre className="bg-slate-900 text-slate-300 p-4 rounded-lg text-sm font-mono overflow-x-auto whitespace-pre w-full">
                      {cssSnippet}
                    </pre>
                    <button
                      type="button"
                      onClick={() => void handleCopyCss()}
                      className="absolute top-2 right-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold rounded opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    >
                      Copy Code
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {activeGradient
                      ? "Add this class to your SVG <use> elements. Ensure you copy the latest sprite which includes the gradient definition!"
                      : "Add this CSS class to your SVG elements to apply the customized size and color."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-3 border-t border-slate-100 bg-white flex items-center justify-between text-xs text-slate-400 flex-shrink-0">
          <span>Click to copy usage code · Double-click to download · Hover ✕ to remove</span>
          <div className="flex items-center gap-2">
            {selectedIconsCount() > 0 && (
              <button
                type="button"
                onClick={() => void handleCopySelected()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold border border-indigo-700 shadow-md transition-all flex items-center gap-1.5"
              >
                <ClipboardIcon className="w-3.5 h-3.5" />
                Copy {selectedIconsCount()} Selected
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleCopySprite()}
              className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-semibold border border-indigo-200 transition-all flex items-center gap-1.5"
            >
              <DuplicateIcon className="w-3.5 h-3.5" />
              Copy Sprite
            </button>
            {source?.type === "library" && (
              <button
                type="button"
                onClick={() => void handleSaveChanges()}
                disabled={!hasChanges || savingChanges}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-200 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlayCircleIcon className="w-3.5 h-3.5" />
                {savingChanges ? "Saving…" : "Save Changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type DemoIconCardProps = {
  id: string;
  index: number;
  symbol: Element | null;
  isSelected: boolean;
  iconSize: number;
  activeColorClass: string | null;
  activeCustomColor: string | null;
  activeGradient: ActiveGradient | null;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  setRenamingId: (value: string | null) => void;
  onClick: () => void;
  onDoubleClick: () => void;
  onDelete: () => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
};

function DemoIconCard({
  id,
  index,
  symbol,
  isSelected,
  iconSize,
  activeColorClass,
  activeCustomColor,
  activeGradient,
  renamingId,
  renameValue,
  setRenameValue,
  setRenamingId,
  onClick,
  onDoubleClick,
  onDelete,
  onRenameCommit,
  onRenameCancel,
}: DemoIconCardProps): ReactNode {
  const isRenaming = renamingId === id;
  const sizeStyle = { width: `${iconSize}px`, height: `${iconSize}px` } as const;
  const viewBox = symbol?.getAttribute("viewBox") || "0 0 24 24";
  const symbolInnerHtml = symbol?.innerHTML ?? "";
  let inlineSvg: ReactNode;
  if (activeGradient) {
    inlineSvg = (
      <svg
        className="transition-all duration-200"
        style={sizeStyle}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={activeGradient.start} />
            <stop offset="100%" stopColor={activeGradient.end} />
          </linearGradient>
          <mask id={`mask-${id}`}>
            <rect width="100%" height="100%" fill="white" />
            <g dangerouslySetInnerHTML={{ __html: symbolInnerHtml }} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill={`url(#grad-${id})`} mask={`url(#mask-${id})`} />
      </svg>
    );
  } else if (activeCustomColor) {
    inlineSvg = (
      <svg
        className="transition-all duration-200"
        style={{ ...sizeStyle, color: activeCustomColor }}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <g dangerouslySetInnerHTML={{ __html: symbolInnerHtml }} />
      </svg>
    );
  } else {
    inlineSvg = (
      <svg
        className={`transition-all duration-200 ${activeColorClass || "text-slate-700"}`}
        style={sizeStyle}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <g dangerouslySetInnerHTML={{ __html: symbolInnerHtml }} />
      </svg>
    );
  }

  return (
    <div
      className={`demo-icon-card relative bg-white p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center cursor-pointer group animate-fade-in-up ${
        isSelected
          ? "ring-2 ring-indigo-500 border-indigo-500 bg-indigo-50/30"
          : "border-slate-200/60 hover:border-indigo-300 hover:shadow-md"
      }`}
      data-id={id}
      style={{ animationDelay: `${(index % 30) * 0.03}s` }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {isSelected && (
        <div className="absolute -top-2 -left-2 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-md z-20">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          type="button"
          className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-300 hover:text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50 transition-all duration-200 flex items-center justify-center shadow-sm"
          title="Rename icon"
          onClick={(event) => {
            event.stopPropagation();
            setRenamingId(id);
            setRenameValue(id);
          }}
        >
          <PencilIcon className="w-3 h-3" />
        </button>
        <button
          type="button"
          className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-300 hover:text-rose-500 hover:border-rose-300 hover:bg-rose-50 transition-all duration-200 flex items-center justify-center shadow-sm"
          title="Remove icon"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <CloseIcon className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center justify-center bg-slate-50 group-hover:bg-indigo-50/50 rounded-lg transition-colors p-4 mb-2.5 w-full h-[110px]">
        {inlineSvg}
      </div>
      {isRenaming ? (
        <input
          type="text"
          value={renameValue}
          autoFocus
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameCommit();
            } else if (event.key === "Escape") {
              onRenameCancel();
            }
          }}
          onBlur={() => setTimeout(onRenameCommit, 150)}
          onClick={(event) => event.stopPropagation()}
          className="w-full px-2 py-1 text-xs font-mono font-medium text-slate-800 bg-indigo-50 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-center"
        />
      ) : (
        <span className="icon-name-label text-xs font-mono font-medium text-slate-600 truncate max-w-full text-center" title={id}>
          {id}
        </span>
      )}
    </div>
  );
}
