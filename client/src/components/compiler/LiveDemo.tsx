// Live demo modal. Opens after a successful compile to preview, search, select, and copy/use the generated symbols.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ChangeEvent, ReactNode } from "react";
import {
  CloseIcon,
  SearchIcon,
  DuplicateIcon,
  ClipboardIcon,
  CheckIcon,
  DownloadIcon,
  PencilIcon,
  SadFaceIcon,
  LockIcon,
  TrashIcon,
} from "../icons";
import VisibilityBadge from "../VisibilityBadge";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import {
  buildDemoHtml,
  classifySymbolVariant,
  copyToClipboard,
} from "../../utils/sprite";
import { createZip, triggerBrowserDownload } from "../../utils/zipBundle";
import { renderSpritePreviewPng } from "../../utils/previewPng";
import { truncateLibName } from "../../utils/toastFormat";

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
  | { type: "library"; id: string; name: string; version?: number; isOwner?: boolean; isPublic?: boolean }
  | { type: "baseSprite"; name?: string; version?: number; isPublic?: boolean }
  | { type: "results" }
  | { type: "scratch" };

export type { Source };

type LiveDemoProps = {
  isOpen: boolean;
  onClose: () => void;
  // The current sprite XML (the same string the Compiler holds).
  sprite: string | null;
  // The list of symbol ids in the sprite.
  symbolIds: string[];
  // Where the sprite came from — controls whether "Save Changes" is shown.
  source?: Source;
  // Which entry point opened the demo. Defaults to "default" so existing callers (Results panel "Live Demo", the base-sprite preview, the post-paste preview, the preview action in the inline paste toast) keep their current behaviour — including the "Save to Library" footer button. Set to "preview" when the demo was opened from the library panel's eye icon. In preview mode the footer replaces "Save to Library" with a "Save Changes" button (disabled until the user edits) that persists edits back to the same library version via the optional `onSave` callback.
  mode?: "default" | "preview";
  // Fired whenever the user mutates the sprite (rename, delete). The parent is expected to update its own `spriteXml`/`symbolIds` state so the rest of the UI stays in sync.
  onUpdate?: (next: { sprite: string; symbolIds: string[]; hasChanges: boolean }) => void;
  // Optional callback for "open the regular save modal" (fallback).
  onOpenSaveModal?: () => void;
  // Persist the in-progress rename/remove edits to the main compiler state. Wired to the footer "Save Changes" button that is rendered ONLY for logged-out users. The parent is expected to commit the supplied `xml` + `symbolIds` to the main compiler state so the Results section reflects the edits immediately. After the commit the LiveDemo shows a "Saved changes to the preview." success toast and closes the popup. No login modal is triggered from this flow — the guest "Save Changes" button silently applies the edits without interrupting the user; persisting to a real library remains a deliberate action via "Save to Library". Only used in the logged-out flow; authenticated users keep using `onSave` for in-place persistence.
  onGuestSaveChanges?: (input: { xml: string; symbolIds: string[] }) => void;
  // Persist the currently-mutated XML back to the library version the demo was opened from. The parent (Compiler) is expected to call `useLibrary().updateContent(sourceId, xml)` and return `true` on success / `false` on failure. The parent may also return the literal string `"deleted"` when the save reduced the sprite to zero icons and the version was auto-removed in place of an update — in that case the demo closes and shows a different toast explaining what happened. Only used by the eye-icon preview flow (see `mode`); other entry points keep their existing save affordances untouched.
  onSave?: (
    input: { xml: string; symbolIds: string[] }
  ) => Promise<boolean | "deleted"> | boolean | "deleted";
  // Optional callback for "copy the current sprite XML to the clipboard". The parent owns the canonical XML, so we delegate.
  onCopySprite?: () => Promise<boolean> | boolean;
  // Optional callback invoked when the user clicks "Copy N Selected". Receives the selected icons' raw XML/standalone SVG payloads.
  onCopyIcons?: (icons: CopiedIcon[]) => void;
  // Optional callback invoked from inside `handleCopySelected` so the parent (Compiler) can open the "Paste Icons To..." modal at its own level. We need the parent to own the modal — not the LiveDemo — because the LiveDemo auto-closes as soon as the paste popup opens (per UX request: "when paste here popup opens close the livedemo popup"). If the modal were a child of the LiveDemo it would unmount with the demo. Receives the just-copied icons so the parent can hand them straight to its own `<PasteIconsModal>`.
  onCopySelectedRequest?: (icons: CopiedIcon[]) => void;
  // Open the "Save to Organization" modal pre-filled with the supplied name. The parent (Compiler) handles the actual save + library refresh.
  onOpenSaveToLibrary?: (input: { suggestedName: string }) => void;
  // Open the "Save to Organization" modal pre-loaded with a sprite that contains ONLY the icons the user selected. Wired to the "Save to Library" footer button when one or more icons are selected — the parent (Compiler) uses the supplied `CopiedIcon[]` to build a fresh sprite XML and lets the user save it as a brand-new library entry. When `onOpenSaveSelectedToLibrary` is provided, selecting icons enables the "Save to Library" button (it would otherwise be disabled in select mode).
  onOpenSaveSelectedToLibrary?: (icons: CopiedIcon[]) => void;
  // Name to pre-fill in the "Save to Library" modal (e.g. the currently-loaded bundle).
  suggestedBundleName?: string;
  // Optional fallback for the "open the regular save modal" flow. Kept around for compatibility with the previous implementation.
  onDownloadBundle?: () => Promise<void> | void;
  // Filename (without extension) used by the save flow when generating the bundle on disk. The Compiler passes the base sprite's filename here.
  bundleFileName?: string;
  // Controlled Custom-CSS state (size, color, gradient, custom color). Lifted to the parent so the values persist when the user closes & reopens the demo (e.g. via the library's preview icon).
  cssState?: LiveDemoCssState;
  onCssStateChange?: (next: LiveDemoCssState) => void;
};

export type CopiedIcon = {
  name: string;
  content: string;
  rawSymbol: string;
};

// Custom-CSS state shared between the icons grid and the parent.
export type LiveDemoCssState = {
  iconSize: number;
  activeColorClass: string | null;
  activeCustomColor: string | null;
  activeGradient: { start: string; end: string } | null;
  useGradient: boolean;
  gradientStart: string;
  gradientEnd: string;
  customColor: string;
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

// Serialise the in-memory `<symbol>` elements into a sprite XML doc.
function serializeLiveSprite(symbols: Element[]): string {
  const inner = symbols
    .map(s => s.outerHTML)
    .join("\n  ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ` +
    `style="width: 0; height: 0; position: absolute;">\n  <defs>\n  ${inner}\n</defs>\n</svg>`
  );
}

// Parse the symbol list out of a sprite XML string.
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
  onGuestSaveChanges,
  onSave,
  onCopySprite,
  onCopyIcons,
  onCopySelectedRequest,
  onOpenSaveToLibrary,
  onOpenSaveSelectedToLibrary,
  suggestedBundleName,
  onDownloadBundle,
  bundleFileName,
  cssState,
  onCssStateChange,
}: LiveDemoProps) {
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectMode, setSelectMode] = useState<boolean>(false);
  const [selectedIcons, setSelectedIcons] = useState<Set<string>>(() => new Set());
  const [displayedSymbolIds, setDisplayedSymbolIds] = useState<string[]>(() => symbolIds ?? []);
  const [activeTab, setActiveTab] = useState<"grid" | "css">("grid");
  // Custom-CSS state. When the parent supplies `cssState` + `onCssStateChange`, the values are owned outside the modal so they survive across opens (e.g. re-opening a saved library version via the eye icon). When the parent doesn't supply them we fall back to local state, so the modal still works in isolation (and in Storybook).
  const defaultCssState: LiveDemoCssState = {
    iconSize: 24,
    activeColorClass: getDefaultActiveColor(),
    activeCustomColor: null,
    activeGradient: null,
    useGradient: false,
    gradientStart: GRADIENT_PRESETS[0].start,
    gradientEnd: GRADIENT_PRESETS[0].end,
    customColor: "#ff0055",
  };
  const [internalCssState, setInternalCssState] = useState<LiveDemoCssState>(defaultCssState);
  const isControlled = cssState !== undefined && onCssStateChange !== undefined;
  const currentCss: LiveDemoCssState = isControlled ? (cssState as LiveDemoCssState) : internalCssState;
  const initialCssRef = useRef<LiveDemoCssState>(defaultCssState);
  const [cssChanged, setCssChanged] = useState<boolean>(false);
  const updateCss = (patch: Partial<LiveDemoCssState>) => {
    const next = { ...currentCss, ...patch };
    if (isControlled) {
      onCssStateChange?.(next);
    } else {
      setInternalCssState(next);
    }
    if (!cssChanged) {
      setCssChanged(true);
    }
    if (selectMode) {
      setSelectMode(false);
      setSelectedIcons(new Set());
    }
  };
  const resetCss = () => {
    const baseline = initialCssRef.current;
    if (isControlled) {
      onCssStateChange?.(baseline);
    } else {
      setInternalCssState(baseline);
    }
    setCssChanged(false);
  };
  const setIconSize = (n: number) => updateCss({ iconSize: n });
  const {
    iconSize,
    activeColorClass,
    activeCustomColor,
    activeGradient,
    useGradient,
    gradientStart,
    gradientEnd,
    customColor,
  } = currentCss;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [, setHasChanges] = useState<boolean>(false);
  const [downloadBusy, setDownloadBusy] = useState<boolean>(false);
  // Tracks uncommitted edits (rename / delete)
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  // "Save Changes" button busy state — true while the parent's `onSave` promise is in-flight.
  const [saveBusy, setSaveBusy] = useState<boolean>(false);
  // Independent "Copied" label flip for the demo footer's "Copy Sprite" button. 
  const [copySpriteCopied, setCopySpriteCopied] = useState<boolean>(false);
  const symbolsRef = useRef<Element[]>([]);
  // Debounce timer used by `handleSingleClick` to defer the copy action.
  const clickTimerRef = useRef<number | null>(null);

  // Read-only mode for the icon grid's per-card rename/delete controls.
  const isReadOnly =
    !!source &&
    source.type === "library" &&
    source.isPublic === true &&
    source.isOwner === false;

  useEffect(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (!isOpen) {
      if (isControlled) {
        onCssStateChange?.({ ...defaultCssState });
      } else {
        setInternalCssState({ ...defaultCssState });
      }
      setCssChanged(false);
      lastSeededSourceRef.current = null;
      return;
    }
    setSearchTerm("");
    setSelectMode(false);
    setSelectedIcons(new Set());
    setActiveTab("grid");
    setHasChanges(false);
    setHasPendingChanges(false);
    setSaveBusy(false);
    setRenamingId(null);
    initialCssRef.current = { ...(isControlled ? (cssState as LiveDemoCssState) : defaultCssState) };
    setCssChanged(false);
  }, [isOpen]);

  function syncSymbols(nextSymbols: Element[]): void {
    symbolsRef.current = nextSymbols;
    setDisplayedSymbolIds(nextSymbols.map((sym) => sym.getAttribute("id") || "").filter(Boolean));
  }
  const lastSeededSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const seedKey = sprite ?? "";
    if (lastSeededSourceRef.current === seedKey) return;
    lastSeededSourceRef.current = seedKey;
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
    setHasPendingChanges(true);
  }

  function deleteIcon(iconId: string): void {
    if (typeof window !== "undefined" && !window.confirm(`Remove "${iconId}" from this sprite?`)) {
      return;
    }
    syncSymbols(symbolsRef.current.filter((sym) => sym.getAttribute("id") !== iconId));
    rebuildSprite();
    showToast(`Removed #${iconId}`, "success");
  }

  function handleSelectAll(): void {
    setSelectedIcons(new Set(filteredIds));
  }
  function handleDeselectAll(): void {
    setSelectedIcons((current) => {
      const next = new Set(current);
      filteredIds.forEach((id) => next.delete(id));
      return next;
    });
  }
  function handleRemoveSelected(): void {
    if (selectedIcons.size === 0) return;
    const count = selectedIcons.size;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Remove ${count} icon${count === 1 ? "" : "s"} from this sprite?`,
      )
    ) {
      return;
    }
    syncSymbols(
      symbolsRef.current.filter((sym) => {
        const id = sym.getAttribute("id") || "";
        return !selectedIcons.has(id);
      }),
    );
    rebuildSprite();
    setSelectedIcons(new Set());
    // When the bulk remove empties the sprite, skip the "Removed N icons" success toast — the "sprite is now empty" warning is the only signal that makes sense. Otherwise show the normal count.
    if (symbolsRef.current.length === 0) {
      showToast("All icons removed. The sprite is now empty.", "warning");
    } else {
      showToast(`Removed ${count} icon${count === 1 ? "" : "s"}`, "success");
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
    if (cssChanged) {
      return;
    }
    if (selectMode) {
      setSelectedIcons((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    if (renamingId !== null) {
      return;
    }
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      const sym = symbolsRef.current.find((s) => s.getAttribute("id") === id);
      if (!sym) {
        showToast("Symbol element not found", "error");
        return;
      }
      const useCode = `<svg class="w-6 h-6"><use href="#${id}"></use></svg>`;
      void copyToClipboard(useCode).then((ok) => {
        showToast(
          ok ? `Copied use snippet for #${id}` : "Failed to copy to clipboard",
          ok ? "success" : "error"
        );
      });
    }, 250);
  }

  function handleIconDoubleClick(id: string): void {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (cssChanged) {
      return;
    }
    if (selectMode || renamingId !== null) {
      return;
    }
    // Strictly download — never copy.
    downloadSingleIcon(id);
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
        content: buildStyledStandaloneSvg(viewBox, innerHTML),
        rawSymbol: `<symbol id="${id}" viewBox="${viewBox}">${innerHTML}</symbol>`,
      });
    });
    onCopyIcons?.(copied);
    if (copied.length > 0) {
      onCopySelectedRequest?.(copied);
    }
    setSelectedIcons(new Set());
    setSelectMode(false);
    onClose?.();
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
    showToast(`Downloaded standalone ${truncateLibName(id)}.svg`, "success");
  }

  function applyPreset(preset: SolidPreset): void {
    updateCss({
      activeColorClass: preset.color,
      activeCustomColor: null,
      activeGradient: null,
      useGradient: false,
    });
  }

  function applyCustomColor(hex: string): void {
    updateCss({
      customColor: hex,
      activeCustomColor: hex,
      activeColorClass: null,
      activeGradient: null,
      useGradient: false,
    });
  }

  function applyGradientPreset(preset: GradientPreset): void {
    updateCss({
      gradientStart: preset.start,
      gradientEnd: preset.end,
      useGradient: true,
      activeGradient: { start: preset.start, end: preset.end },
      activeColorClass: null,
      activeCustomColor: null,
    });
  }

  function handleGradientToggle(checked: boolean): void {
    if (checked) {
      updateCss({
        useGradient: true,
        activeGradient: { start: gradientStart, end: gradientEnd },
        activeColorClass: null,
        activeCustomColor: null,
      });
    } else {
      updateCss({
        useGradient: false,
        activeGradient: null,
        activeColorClass: getDefaultActiveColor(),
      });
    }
  }

  function handleGradientStart(next: string): void {
    updateCss({
      gradientStart: next,
      ...(useGradient
        ? { activeGradient: { start: next, end: gradientEnd } }
        : {}),
    });
  }

  function handleGradientEnd(next: string): void {
    updateCss({
      gradientEnd: next,
      ...(useGradient
        ? { activeGradient: { start: gradientStart, end: next } }
        : {}),
    });
  }

  // Resolve the effective color the icon grid is currently applying. 
  function resolveActiveColor(): { kind: "gradient"; start: string; end: string } | { kind: "color"; hex: string } | null {
    if (useGradient && activeGradient) {
      return { kind: "gradient", start: activeGradient.start, end: activeGradient.end };
    }
    if (activeCustomColor) {
      return { kind: "color", hex: activeCustomColor };
    }
    const preset = SOLID_PRESETS.find((p) => p.color === activeColorClass);
    if (preset) return { kind: "color", hex: preset.hex };
    return null;
  }

  function buildStyledStandaloneSvg(viewBox: string, inner: string): string {
    const variant = classifySymbolVariant(inner);
    const color = resolveActiveColor();
    const sizeAttrs = `width="${iconSize}" height="${iconSize}"`;
    if (variant === "multicolor" || !color) {
      return `<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs} viewBox="${viewBox}">${inner}</svg>`;
    }
    if (color.kind === "color") {
      if (variant === "outlined") {
        // Outlined icons: paint the stroke with the custom colour and null out the fill so the recoloured outline reads as a clean line.
        return (
          `<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs} viewBox="${viewBox}">` +
          `<style>svg * { fill: none !important; stroke: ${color.hex} !important; }</style>` +
          `${inner}` +
          `</svg>`
        );
      }
      // Solid icons: paint the fill with the custom colour and null out the stroke so no leftover outline shows through.
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs} viewBox="${viewBox}" color="${color.hex}">` +
        `<style>svg * { fill: ${color.hex} !important; stroke: none !important; }</style>` +
        `${inner}` +
        `</svg>`
      );
    }
    const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`;
    const gradRule = variant === "outlined"
      ? `svg * { fill: none !important; stroke: url(#${gradId}) !important; }`
      : `svg * { fill: url(#${gradId}) !important; stroke: none !important; }`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs} viewBox="${viewBox}">` +
      `<defs>` +
      `<linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">` +
      `<stop offset="0%" stop-color="${color.start}"/>` +
      `<stop offset="100%" stop-color="${color.end}"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<style>${gradRule}</style>` +
      `${inner}` +
      `</svg>`
    );
  }

  // Inject the active gradient definition into a hidden <svg> in the document body so <use href="#id"> can reference it. We also stage a per-variant scoped <style> in the SAME SVG as the gradient definition: CSS rules declared in the icon host cascade into the shadow tree of <use> references and apply the `url(#demo-icon-gradient)` paint server to the right attribute. Doing this in the card's <svg> doesn't work — the use shadow tree only inherits styles from its own SVG root, not from the card.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const GRAD_ID = "demo-icon-gradient";
    const STYLE_ID = "live-demo-gradient-style";
    // The primary <style> lives in the gradient host, but we also clone it
    // into the sprite host (see below) so the <use> shadow trees can pick
    // up the rules even when they're rendered outside the gradient host's
    // SVG root. We give the clone a distinct, well-known id so the
    // cleanup branch can reliably remove BOTH copies — otherwise the
    // duplicate in the sprite host lingers after "Reset custom CSS" and
    // keeps applying `fill: url(#demo-icon-gradient) !important` against
    // a now-removed gradient, which silently nulls out the icon paint
    // and hides every icon in the grid.
    const SPRITE_STYLE_ID = "live-demo-gradient-style-sprite";
    const existingGrad = document.getElementById(GRAD_ID);
    const existingStyle = document.getElementById(STYLE_ID);
    const existingSpriteStyle = document.getElementById(SPRITE_STYLE_ID);
    if (!activeGradient) {
      if (existingGrad) existingGrad.remove();
      if (existingStyle) existingStyle.remove();
      // Remove the duplicate <style> we previously appended to the
      // sprite host so the `url(#demo-icon-gradient)` references it
      // contains no longer leak across the gradient → solid transition.
      if (existingSpriteStyle) existingSpriteStyle.remove();
      // Reset any inline paint we previously forced on the symbol's
      // elements so a freshly returned solid colour mode shows the
      // icon's original paint (driven by the card's `color`).
      const host = document.getElementById("live-demo-sprite-host");
      if (host) {
        host.querySelectorAll("[data-live-demo-paint]").forEach((el) => {
          el.removeAttribute("data-live-demo-paint");
        });
      }
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
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "24");
    grad.setAttribute("y2", "24");
    const stop1 = document.createElementNS(SVG_NS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", activeGradient.start);
    const stop2 = document.createElementNS(SVG_NS, "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", activeGradient.end);
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    const styleEl = document.createElementNS(SVG_NS, "style") as unknown as HTMLStyleElement;
    styleEl.setAttribute("id", STYLE_ID);
    const spriteHost = document.getElementById("live-demo-sprite-host");
    const cssChunks: string[] = [];
    if (spriteHost) {
      spriteHost.querySelectorAll("symbol").forEach((sym) => {
        const symId = sym.getAttribute("id");
        if (!symId) return;
        const inner = sym.innerHTML;
        // Re-classify against the raw inner markup to decide the rule.
        // We don't have a DOMParser here, so re-use the in-memory helpers.
        const variant = classifySymbolVariant(inner);
        if (variant === "multicolor") return;
        if (variant === "outlined") {
          cssChunks.push(
            `#${symId} * { fill: none !important; stroke: url(#${GRAD_ID}) !important; }`,
          );
        } else {
          cssChunks.push(
            `#${symId} * { fill: url(#${GRAD_ID}) !important; stroke: none !important; }`,
          );
        }
      });
    }
    styleEl.textContent = cssChunks.join("\n");
    if (existingStyle) existingStyle.remove();
    // Append the style to the same svg that holds the gradient defs so
    // the use shadow tree picks it up. Also append a duplicate into the
    // sprite host in case the gradient host's <svg> isn't in the same
    // document subtree as the <use> references. The duplicate is tagged
    // with `SPRITE_STYLE_ID` so the cleanup branch (when `activeGradient`
    // is cleared, e.g. via the "Reset custom css" button) can locate and
    // remove it; without this, the stale `url(#demo-icon-gradient)`
    // references would survive and hide every icon in the grid.
    svg.appendChild(styleEl);
    if (spriteHost) {
      // Remove any leftover clone from a previous gradient run before
      // appending a fresh one — we want to be sure we never stack up
      // stale duplicates if the effect re-runs while one is still
      // attached.
      const previousClone = document.getElementById(SPRITE_STYLE_ID);
      if (previousClone) previousClone.remove();
      const dup = (styleEl.cloneNode(true) as unknown) as Element;
      dup.setAttribute("id", SPRITE_STYLE_ID);
      spriteHost.appendChild(dup);
    }
  }, [activeGradient]);

  // Ensure the sprite XML (symbols) is available in the document so <use href="#id"> inside the modal can resolve symbol references. We host the sprite in a hidden <svg> container so the symbol elements stay in the SVG namespace and the browser can resolve <use> lookups against the live DOM 1:1 — matching the legacy app.js behaviour and avoiding the namespace re-scoping bugs that broke the previous "innerHTML into a <g>" rendering.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const HOST_ID = "live-demo-sprite-host";
    let host = document.getElementById(HOST_ID) as SVGSVGElement | null;
    if (host && host.namespaceURI !== SVG_NS) {
      // An older revision of the modal stored the host as a <div> in the
      // HTML namespace. Symbols appended there were re-served as HTML
      // nodes and <use> could not resolve them, so we throw the legacy
      // host away and recreate it in the SVG namespace below.
      host.remove();
      host = null;
    }
    if (!host) {
      host = document.createElementNS(SVG_NS, "svg");
      host.setAttribute("id", HOST_ID);
      host.setAttribute("aria-hidden", "true");
      host.setAttribute("focusable", "false");
      host.style.cssText =
        "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;";
      document.body.appendChild(host);
    }
    // Replace host children with the parsed sprite's children. Using
    // DOMParser + replaceChildren preserves the SVG namespace of every
    // <symbol> and its descendants so <use href="#id"> can resolve them
    // without re-scoping. The legacy app.js took the same shortcut of
    // dropping the whole sprite XML into a hidden div, but that worked
    // there because the icons were only ever rendered as <use> against
    // an HTML <body> — we follow the same approach but in the SVG
    // namespace for the host so each <symbol> keeps its original markup.
    host.replaceChildren();
    if (sprite) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(sprite, "image/svg+xml");
      if (!doc.querySelector("parsererror")) {
        const symbols = Array.from(doc.querySelectorAll("symbol"));
        // Clone every <symbol> from the parsed sprite into the live host.
        // `importNode` keeps the SVG namespace so the cloned nodes are
        // recognisable to <use href="#…"> lookups in the page.
        symbols.forEach((sym) => {
          const imported = document.importNode(sym, true);
          host!.appendChild(imported);
        });
      }
    }
    return () => {
      // Remove the host when the modal is closed to avoid leaking defs
      if (!isOpen) {
        const existing = document.getElementById(HOST_ID);
        if (existing) existing.remove();
      }
    };
  }, [isOpen, sprite]);

  // Drop the hidden gradient host when the modal closes so stale gradient defs don't leak between sessions.
  useEffect(() => {
    if (isOpen) return;
    if (typeof document === "undefined") return;
    const host = document.getElementById("live-demo-gradient-host");
    if (host) host.remove();
  }, [isOpen]);

  const cssSnippet = useMemo<string>(() => {
    if (activeGradient) {
      return (
        `.icon-gradient {\n` +
        `  width: ${iconSize}px;\n` +
        `  height: ${iconSize}px;\n` +
        `}\n` +
        `.icon-gradient * {\n` +
        `  fill: url(#demo-icon-gradient);\n` +
        `  stroke: url(#demo-icon-gradient);\n` +
        `}`
      );
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
      ok ? "Copied to clipboard!" : "Failed to copy to clipboard",
      ok ? "success" : "error"
    );
    // Mirror the inline button text flip for the demo footer's "Copy Sprite" button. 
    setCopySpriteCopied(true);
    window.setTimeout(() => setCopySpriteCopied(false), 1500);
  }

  // Open the "Save to Organization" modal. The parent handles the actual save + library refetch when the user confirms.
  function handleOpenSaveToLibrary(): void {
    if (!currentUser) {
      onOpenSaveModal?.();
      return;
    }
    if (selectMode && selectedIcons.size > 0 && onOpenSaveSelectedToLibrary) {
      const copied: CopiedIcon[] = [];
      selectedIcons.forEach((id) => {
        const sym = symbolsRef.current.find((s) => s.getAttribute("id") === id);
        if (!sym) return;
        const viewBox = sym.getAttribute("viewBox") || "0 0 24 24";
        const innerHTML = sym.innerHTML;
        copied.push({
          name: id,
          content: buildStyledStandaloneSvg(viewBox, innerHTML),
          rawSymbol: `<symbol id="${id}" viewBox="${viewBox}">${innerHTML}</symbol>`,
        });
      });
      if (copied.length > 0) {
        onOpenSaveSelectedToLibrary(copied);
        setSelectedIcons(new Set());
        setSelectMode(false);
        onClose?.();
        return;
      }
    }
    const fallbackName =
      suggestedBundleName ||
      (source && source.type === "library" ? source.name : "") ||
      bundleFileName?.replace(/\.svg$/i, "") ||
      `sprite-${new Date().toLocaleDateString()}`;
    onOpenSaveToLibrary?.({ suggestedName: fallbackName });
  }

  async function handleSaveChanges(): Promise<void> {
    if (saveBusy) return;
    if (
      !source ||
      (source.type !== "library" &&
        source.type !== "baseSprite" &&
        source.type !== "results")
    ) {
      showToast("No preview source to save to.", "error");
      return;
    }
    if (!onSave) {
      showToast("Save handler not configured.", "error");
      return;
    }
    if (!hasPendingChanges) {
      showToast("No changes to save.", "warning");
      return;
    }
    const nextIds = symbolsRef.current
      .map((s) => s.getAttribute("id") || "")
      .filter(Boolean);
    const xml = serializeLiveSprite(symbolsRef.current);
    setSaveBusy(true);
    try {
      const result = await onSave({ xml, symbolIds: nextIds });
      if (result === false) {
        return;
      }
      setHasPendingChanges(false);
      setHasChanges(false);
      if (result === "deleted") {
        const label =
          source.type === "library"
            ? `${truncateLibName(source.name)} v${source.version ?? 1}`
            : "the preview";
        showToast(
          `All icons removed. ${label} was deleted from the library.`,
          "warning"
        );
      } else {
        const successMessage =
          source.type === "library"
            ? `Saved changes to ${truncateLibName(source.name)} v${source.version ?? 1}.`
            : "Saved changes to the preview.";
        showToast(successMessage, "success");
      }
      onClose?.();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save changes.",
        "error"
      );
    } finally {
      setSaveBusy(false);
    }
  }
  async function handleDownloadBundle(): Promise<void> {
    if (downloadBusy) return;
    if (!sprite) {
      showToast("No sprite to export.", "error");
      return;
    }
    if (onDownloadBundle) {
      setDownloadBusy(true);
      try {
        await onDownloadBundle();
      } finally {
        setDownloadBusy(false);
      }
      return;
    }
    setDownloadBusy(true);
    try {
      const fileName = (bundleFileName || "sprite").replace(/\.svg$/i, "");
      const spriteXml = serializeLiveSprite(symbolsRef.current);
      const ids = symbolsRef.current
        .map((s) => s.getAttribute("id") || "")
        .filter(Boolean);
      const demoHtml = buildDemoHtml(ids, spriteXml);
      const previewPng = await renderSpritePreviewPng(spriteXml, ids);
      const entries: { name: string; data: string | Uint8Array }[] = [
        { name: `${fileName}.svg`, data: spriteXml },
        { name: "demo.html", data: demoHtml },
      ];
      if (previewPng) {
        entries.push({
          name: "preview.png",
          data: new Uint8Array(await previewPng.arrayBuffer()),
        });
      }
      const blob = createZip(entries);
      triggerBrowserDownload(blob, `${fileName}-bundle.zip`);
      showToast("Sprite bundle downloaded.", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to build bundle.",
        "error"
      );
    } finally {
      setDownloadBusy(false);
    }
  }

  const shouldShowSaveChanges =
    !!source &&
    !!onSave &&
    (source.type === "baseSprite" ||
      source.type === "results" ||
      (source.type === "library" && source.isOwner !== false));
  const shouldShowSaveToLibrary =
    !!onOpenSaveToLibrary &&
    (source?.type === "scratch" || source?.type === "results");

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all duration-300"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden transform transition-all duration-300">
        <div className="flex flex-col border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between px-6 pt-4 pb-2">
            <div className="min-w-0 flex-1 pr-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Live Demo
                </h3>
                {(() => {
                  const identity =
                    source?.type === "library"
                      ? {
                          name: source.name,
                          version: source.version,
                          isPublic: !!source.isPublic,
                        }
                      : source?.type === "baseSprite" && source.name
                        ? {
                            name: source.name,
                            version: source.version,
                            isPublic: !!source.isPublic,
                          }
                        : null;
                  if (!identity) return null;
                  return (
                    <>
                      <span
                        className="text-sm text-slate-500 truncate mt-0.5 max-w-50"
                        title={`${identity.name} (v${identity.version ?? 1})`}
                      >
                        {identity.name}
                      </span>
                      <span className="inline-flex shrink-0 items-center rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-mono font-semibold text-indigo-600">
                        v{identity.version ?? 1}
                      </span>
                      <VisibilityBadge
                        isPublic={identity.isPublic}
                        title={
                          identity.isPublic
                            ? "Anyone with access can view and use this library."
                            : "Only you can view and access this library."
                        }
                      />
                    </>
                  );
                })()}
              </div>
              <p className="text-xs text-slate-400">
                Preview and test your compiled SVG symbols live
              </p>
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
          <div className="flex items-end justify-between gap-4 px-6 border-b border-slate-100">
            <div className="flex gap-4">
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
            {cssChanged && (
              <button
                type="button"
                onClick={resetCss}
                title={
                  cssChanged
                    ? "Restore the size, color, and gradient values the modal opened with."
                    : "No custom-CSS changes to reset."
                }
                className="mb-2 px-4 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 bg-white border-slate-300 text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-3M20 14a8 8 0 01-14 3"
                  />
                </svg>
                Reset custom css
              </button>
            )}
          </div>
        </div>

        {activeTab === "grid" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-6 pt-3.5 pb-2 bg-slate-50 border-b border-slate-100 text-sm shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
                <div className="flex items-center gap-2 shrink-0">
                  {currentUser && (
                    <label
                      className={`flex items-center gap-2 group ${
                        cssChanged
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer"
                      }`}
                      title={
                        cssChanged
                          ? "Reset Custom CSS to enable Select Icons."
                          : undefined
                      }
                    >
                      {/* The `peer-disabled:cursor-not-allowed` on the visual
                          track + dot mirrors the input's `disabled` state
                          directly, so the not-allowed cursor is shown
                          consistently across the whole toggle (track, dot,
                          AND label text) when CSS is dirty. The label-level
                          `cursor-not-allowed` alone relies on CSS
                          inheritance, which doesn't reliably reach the
                          visual elements through the peer-input layer —
                          so we apply it explicitly via the peer state. */}
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={selectMode}
                          disabled={cssChanged}
                          onChange={(event) => {
                            const next = event.target.checked;
                            setSelectMode(next);
                            if (!next) {
                              setSelectedIcons(new Set());
                            }
                          }}
                          className="peer sr-only disabled:cursor-not-allowed"
                        />
                        <div className="block h-6 w-10 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-600 peer-disabled:cursor-not-allowed" />
                        <div className="dot absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 peer-disabled:cursor-not-allowed" />
                      </div>
                      <span
                        className={`text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors ${cssChanged && "cursor-not-allowed"}`}
                      >
                        Select Icons
                      </span>
                    </label>
                  )}
                </div>
              </div>
              
              {currentUser && selectMode && !isReadOnly && (
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      // All-visible-selected → label is "Deselect All".
                      // Otherwise → label is "Select All".
                      if (filteredIds.every((id) => selectedIcons.has(id))) {
                        handleDeselectAll();
                      } else {
                        handleSelectAll();
                      }
                    }}
                    disabled={filteredIds.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:hover:border-slate-200 disabled:hover:bg-slate-100 disabled:hover:text-slate-400"
                  >
                    {filteredIds.every((id) => selectedIcons.has(id)) &&
                    filteredIds.length > 0
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveSelected}
                    disabled={selectedIcons.size === 0}
                    title={
                      selectedIcons.size === 0
                        ? "Select icons to remove."
                        : `Remove ${selectedIcons.size} selected icon${selectedIcons.size === 1 ? "" : "s"} from this sprite.`
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:border-rose-100 disabled:bg-white disabled:text-rose-300 disabled:hover:border-rose-100 disabled:hover:bg-white disabled:hover:text-rose-300"
                  >
                    <TrashIcon className="h-3 w-3" />
                    Remove ({selectedIcons.size})
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 custom-scrollbar">
              {filteredIds.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-slate-400">
                  <SadFaceIcon
                    className="w-12 h-12 mb-3 text-slate-300"
                    strokeWidth={1.5}
                  />
                  <span className="text-sm font-medium">
                    No matching symbols found
                  </span>
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
                        symbol={
                          symbolsRef.current.find(
                            (sym) => sym.getAttribute("id") === id,
                          ) ?? null
                        }
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
                        onDoubleClick={() => handleIconDoubleClick(id)}
                        onDelete={() => deleteIcon(id)}
                        onRenameCommit={commitRename}
                        onRenameCancel={() => setRenamingId(null)}
                        isReadOnly={isReadOnly}
                        selectMode={selectMode}
                        cssChanged={cssChanged}
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
              <h4 className="text-lg font-bold text-slate-800 mb-6">
                Customize CSS Variables
              </h4>
              <div className="space-y-8">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider w-16">
                    Size:
                  </span>
                  <input
                    type="range"
                    min={16}
                    max={96}
                    value={iconSize}
                    onChange={(event) =>
                      setIconSize(Number(event.target.value))
                    }
                    className="h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 flex-1"
                  />
                  <span className="text-sm text-slate-600 font-mono font-bold w-12 text-right">
                    {iconSize}px
                  </span>
                </div>

                <div className="flex flex-col gap-4 mt-2">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider w-16">
                      Solid:
                    </span>
                    <div
                      className={`flex flex-wrap items-center gap-3 ${useGradient ? "opacity-50 pointer-events-none transition-opacity" : ""}`}
                    >
                      {SOLID_PRESETS.map((preset) => (
                        <button
                          key={preset.color}
                          type="button"
                          title={preset.label}
                          onClick={() => applyPreset(preset)}
                          className={`w-8 h-8 rounded-full ${preset.swatch} border border-slate-300 focus:outline-none transition-all active:scale-90 ${
                            activeColorClass === preset.color &&
                            !useGradient &&
                            !activeCustomColor
                              ? "scale-110 ring-offset-2 ring-indigo-500 ring-2"
                              : ""
                          }`}
                        />
                      ))}
                      <div className="border-l border-slate-200 pl-3 ml-1 h-6 flex items-center">
                        <div
                          className={`relative w-8 h-8 rounded-full overflow-hidden border border-slate-300 shadow-sm transition-all cursor-pointer focus-within:ring-indigo-500 ${
                            activeCustomColor
                              ? "scale-110 ring-offset-2 ring-indigo-500 ring-2"
                              : "ring-2 ring-indigo-500/0"
                          }`}
                          title="Custom Solid Color"
                        >
                          <input
                            type="color"
                            value={customColor}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              applyCustomColor(event.target.value)
                            }
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
                        onChange={(event) =>
                          handleGradientToggle(event.target.checked)
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Grad:
                      </span>
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
                            style={{
                              background: `linear-gradient(135deg, ${preset.start}, ${preset.end})`,
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 border-l border-slate-200 pl-3 ml-1 h-6">
                        <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-full border border-slate-200 shadow-inner">
                          <span className="text-[10px] font-bold text-slate-500 uppercase ml-1">
                            Start
                          </span>
                          <div className="relative w-6 h-6 rounded-full overflow-hidden border border-slate-300 cursor-pointer">
                            <input
                              type="color"
                              value={gradientStart}
                              onChange={(event) =>
                                handleGradientStart(event.target.value)
                              }
                              className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer"
                            />
                          </div>
                          <svg
                            className="w-3 h-3 text-slate-300 mx-1"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M14 5l7 7m0 0l-7 7m7-7H3"
                            />
                          </svg>
                          <span className="text-[10px] font-bold text-slate-500 uppercase">
                            End
                          </span>
                          <div className="relative w-6 h-6 rounded-full overflow-hidden border border-slate-300 cursor-pointer mr-1">
                            <input
                              type="color"
                              value={gradientEnd}
                              onChange={(event) =>
                                handleGradientEnd(event.target.value)
                              }
                              className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 w-full overflow-hidden">
                  <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                    Generated CSS Code
                  </h5>
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

        <div className="px-6 py-3 border-t border-slate-100 bg-white flex items-center justify-between text-xs text-slate-400 shrink-0">
          {isReadOnly && source?.type === "library" ? (
            <span className="flex items-center gap-1.5 text-slate-500">
              <LockIcon className="h-3 w-3 shrink-0 text-slate-400" />
              Only the library owner can rename or remove icons in this shared
              library.
            </span>
          ) : (
            !selectMode && !cssChanged && activeTab === "grid" && (
              <span>
                click to copy usage code · Double-click to download · Hover ✕
                to remove
              </span>
            )
          )}
          <div className="flex items-center gap-2 ml-auto">
            {currentUser && selectedIconsCount() > 0 && (
              <button
                type="button"
                onClick={() => void handleCopySelected()}
                disabled={cssChanged}
                title={
                  cssChanged
                    ? "Reset Custom CSS to enable this action."
                    : undefined
                }
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold border border-indigo-700 shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
              >
                <ClipboardIcon className="w-3.5 h-3.5" />
                Copy {selectedIconsCount()} Selected
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleCopySprite()}
              disabled={cssChanged}
              title={
                cssChanged
                  ? "Reset Custom CSS to enable this action."
                  : undefined
              }
              className="px-4 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5 bg-white border-slate-300 text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 disabled:hover:bg-white disabled:hover:border-slate-300 disabled:hover:text-slate-700 disabled:cursor-not-allowed"
            >
              <DuplicateIcon className="w-3.5 h-3.5 mt-px" />
              {copySpriteCopied ? "Copied" : "Copy Sprite"}
            </button>
            {currentUser ? (
              <>
                {shouldShowSaveChanges &&
                  !(source?.type === "results" && selectMode) && (
                    <button
                      type="button"
                      onClick={() => void handleSaveChanges()}
                      disabled={!hasPendingChanges || saveBusy || cssChanged}
                      title={
                        cssChanged
                          ? "Reset Custom CSS to enable this action."
                          : hasPendingChanges
                            ? source.type === "library"
                              ? "Persist the renamed / removed icons back to this library version."
                              : source.type === "results"
                                ? "Persist the renamed / removed icons back to the generated sprite."
                                : "Persist the renamed / removed icons back to this base sprite."
                            : "No changes to save yet. Rename or remove an icon to enable this button."
                      }
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-200 transition-all flex items-center gap-1.5 disabled:hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                      {saveBusy ? "Saving…" : "Save Changes"}
                    </button>
                  )}
                {shouldShowSaveToLibrary && selectMode && (
                  <button
                    type="button"
                    onClick={() => handleOpenSaveToLibrary()}
                    disabled={
                      downloadBusy || cssChanged || selectedIconsCount() === 0
                    }
                    title={
                      cssChanged
                        ? "Reset Custom CSS to enable this action."
                        : selectedIconsCount() === 0
                          ? "Select at least one icon to save as a new library."
                          : `Save ${selectedIconsCount()} selected icon${selectedIconsCount() === 1 ? "" : "s"} as a new library.`
                    }
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-200 transition-all flex items-center gap-1.5 disabled:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    {selectedIconsCount() > 0
                      ? `Save ${selectedIconsCount()} Selected to Library`
                      : "Save to Library"}
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (onGuestSaveChanges) {
                      const nextIds = symbolsRef.current
                        .map((s) => s.getAttribute("id") || "")
                        .filter(Boolean);
                      const xml = serializeLiveSprite(symbolsRef.current);
                      onGuestSaveChanges({ xml, symbolIds: nextIds });
                      showToast("Saved changes to the preview.", "success");
                      onClose?.();
                      return;
                    }
                    onOpenSaveModal?.();
                  }}
                  disabled={!hasPendingChanges || cssChanged}
                  title={
                    cssChanged
                      ? "Reset Custom CSS to enable this action."
                      : !hasPendingChanges
                        ? "Rename or remove an icon to enable this button."
                        : "Apply your edits to the Results section."
                  }
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-200 transition-all flex items-center gap-1.5 disabled:hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                  Save Changes
                </button>
                {source?.type !== "baseSprite" && (
                  <button
                    type="button"
                    onClick={() => void handleDownloadBundle()}
                    disabled={downloadBusy || selectMode || cssChanged}
                    title={
                      cssChanged
                        ? "Reset Custom CSS to enable this action."
                        : undefined
                    }
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-200 transition-all flex items-center gap-1.5 disabled:hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <DownloadIcon className="w-3.5 h-3.5" />
                    {downloadBusy ? "Preparing…" : "Download sprite"}
                  </button>
                )}
              </>
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
  // When true, hide the per-card rename and delete controls. Used for public library entries the current user does not own — the user can still preview and copy icons, but cannot mutate them in place.
  isReadOnly?: boolean;
  selectMode?: boolean;
  cssChanged?: boolean;
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
  isReadOnly = false,
  selectMode = false,
  cssChanged = false,
}: DemoIconCardProps): ReactNode {
  const isRenaming = renamingId === id;
  const sizeStyle = { width: `${iconSize}px`, height: `${iconSize}px` } as const;
  const viewBox = symbol?.getAttribute("viewBox") || "0 0 24 24";
  const symbolInnerHtml = symbol?.innerHTML ?? "";
  // Resolve the active solid color (gradient is handled in its own branch).
  const preset = activeColorClass
    ? SOLID_PRESETS.find((p) => p.color === activeColorClass)
    : undefined;
  const activeHex = activeCustomColor || (preset ? preset.hex : null);
  const iconVariant = classifySymbolVariant(symbolInnerHtml);
  const isMulticolor = iconVariant === "multicolor";
  // Drive the icon's colour via the card's `color` attribute. The symbol
  // references live in the hidden host, and the upload pipeline stores
  // paint as `var(--icon-color, currentColor)`, so the `currentColor`
  // fallback resolves through the card's `color` value. For multicolor
  // icons we leave the symbol untouched (no scoping) so the original
  // palette stays intact. Gradient mode is handled via a global scoped
  // <style> in the gradient host — see the activeGradient effect — so
  // the card doesn't need to emit a per-card <style> here.
  const wrapperColorStyle = isMulticolor
    ? ({ color: "#1e293b" } as const)
    : activeGradient
      ? undefined
      : ({ color: activeHex ?? "#334155",fill: activeHex ?? "#334155", } as const);
  // Render via <use href="#id"> referencing the <symbol> element in the
  // modal's hidden host (`live-demo-sprite-host`). This matches the legacy
  // app.js approach: the browser resolves the symbol reference against the
  // live DOM, so the symbol's original markup, viewBox, and namespace
  // declarations are preserved 1:1 — no re-scoping inside a foreign <g>.
  // That fixes the "icons render broken / wrong colour" issue that the
  // previous `dangerouslySetInnerHTML` injection caused.
  const useSnippet: ReactNode = (
    <svg
      className="transition-all duration-200"
      style={{ ...sizeStyle, ...wrapperColorStyle }}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      data-demo-icon-style={id}
      data-icon-variant={iconVariant}
    >
      <use href={`#${id}`} />
    </svg>
  );

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
      {!isReadOnly && !selectMode && !cssChanged && (
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
      )}
      <div className="flex items-center justify-center bg-slate-50 group-hover:bg-indigo-50/50 rounded-lg transition-colors p-4 mb-2.5 w-full h-27.5">
        {useSnippet}
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
