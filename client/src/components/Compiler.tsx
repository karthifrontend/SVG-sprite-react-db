// Main Compiler view. Coordinates dropzone, mode tabs, generation, live demo, and library save/load flows.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useFileDropzone } from "../hooks/useFileDropzone";
import { useSpriteCompiler } from "../hooks/useSpriteCompiler";
import { useLibrary, notifyLibraryChanged } from "../hooks/useLibrary";
import { getSpriteById, putSprite, saveSprite, type SpriteSummary } from "../api/sprites";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { buildSpriteXml, extractSymbolsFromSprite, sortSymbolsById } from "../utils/sprite";
import { copyToClipboard } from "../utils/sprite";
import CompilerHeader from "./compiler/CompilerHeader";
import ExistingSpriteSection from "./compiler/ExistingSpriteSection";
import FileDropzone from "./compiler/FileDropzone";
import GenerateButton from "./compiler/GenerateButton";
import InlineSaveSection, { type InlineSaveValue } from "./compiler/InlineSaveSection";
import LibraryPanel from "./compiler/LibraryPanel";
import LiveDemoModal, { type CopiedIcon, type LiveDemoCssState } from "./compiler/LiveDemo";
import type { Source as LiveDemoSource } from "./compiler/LiveDemo";
import PasteIconsModal from "./compiler/PasteIconsModal";
import SaveToLibraryModal from "./compiler/SaveToLibraryModal";
import IconConflictModal from "./compiler/IconConflictModal";
import type { ConflictResolution, IconConflict } from "../hooks/useSpriteCompiler";
import SelectFromLibraryModal from "./compiler/SelectFromLibraryModal";
import { buildDemoHtml } from "../utils/sprite";
import { createZip, triggerBrowserDownload } from "../utils/zipBundle";
import { renderSpritePreviewPng } from "../utils/previewPng";
import { truncateLibName } from "../utils/toastFormat";
import ModeTabs, { type CompilerMode } from "./compiler/ModeTabs";
import ResultsPanel from "./compiler/ResultsPanel";
import StagedFilesList from "./compiler/StagedFilesList";
import UserGuidePanel from "./compiler/UserGuidePanel";

type CompilerProps = {
  onRequireAuth?: () => void;
  libraryOpen: boolean;
  onLibraryToggle: (next: boolean) => void;
};
const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

// Compiler — page-level orchestrator. Owns mode/base-sprite state, inline save state, and the guide drawer. The library panel collapse state is owned by `App` so the Navbar's expand button and the panel can stay in sync. All UI sections are composed from `./compiler`.
function Compiler({ onRequireAuth, libraryOpen, onLibraryToggle }: CompilerProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  // Wrap the dropzone so that adding new files after a sprite has been generated returns the upload section to its initial stage (clears the result, the hasGenerated flag, and the mode lock). We also surface a warning toast whenever the user tries to stage a file whose name+size is already in the list, so they know the duplicate was intentionally skipped.
  const baseDropzone = useFileDropzone({
    accept: "icons",
    onSkipped: (count) => {
      showToast(
        count === 1
          ? "1 duplicate skipped."
          : `${count} duplicates skipped.`,
        "warning"
      );
    },
    onRejected: (rejected) => {
      // Wrong-type SVG: the user dropped a sprite sheet into the icon upload section. Use warning tone (matches the duplicate-skip toast colour) and point them at the right upload target.
      showToast(
        rejected.kind === "sprite"
          ? `${rejected.fileName} is a sprite sheet, drop standalone icons here.`
          : `${rejected.fileName} is not an SVG file.`,
        "warning"
      );
    },
  });
  const {
    files,
    clear: clearFiles,
    removeAt,
    removeFiles,
    onDragOver: baseOnDragOver,
    appendFiles,
    openPicker,
    inputRef,
  } = baseDropzone;

  // True once the user has generated a sprite in this session. Drives the "hide staged list / sign-in hint" behaviour and the tab-lock on the Generate button.
  const [hasGenerated, setHasGenerated] = useState(false);

  function resetForNewUpload() {
    // Drop the generated result so the UI looks like a fresh upload (no sprite panel, staged list and sign-in hint reappear). `resetSprite` already clears the sprite's error/symbols/url.
    resetSprite();
    setHasGenerated(false);
    // The tab and base sprite file stay as the user left them. We intentionally do NOT force a tab switch on upload — the user expects to remain on whichever tab they were working in.
    setActiveBundleName("");
    setLiveDemoSource({ type: "scratch" });
    // A fresh upload has no source library to hide from the paste popup, so drop the hint.
    setPasteExcludeBundleName("");
    setAddIconsTargetVersionId(null);
    setAddIconsTargetVersionNumber(null);
    setInlineSave({
      enabled: false,
      name: "",
      saveAsNew: false,
      hasNameConflict: false,
      isPublic: false,
    });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const incoming = e.dataTransfer?.files ?? null;
    // If a sprite was already generated, treat the new upload as a fresh start: clear the staged batch and the generated result. Otherwise just append the dropped files (original behaviour).
    if (hasGenerated) {
      clearFiles();
      resetForNewUpload();
      if (incoming) baseDropzone.addFiles(incoming);
    } else if (incoming) {
      baseDropzone.addFiles(incoming);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const incoming = e.target.files;
    if (hasGenerated) {
      clearFiles();
      resetForNewUpload();
      if (incoming && incoming.length > 0) baseDropzone.addFiles(incoming);
    } else if (incoming && incoming.length > 0) {
      baseDropzone.addFiles(incoming);
    }
    // Reset so the same file can be picked again later.
    e.target.value = "";
  }

  const {
    generating,
    spriteUrl,
    spriteXml,
    symbolIds,
    error,
    generate,
    applyConflictResolutions,
    loadFromLibrary,
    waitForSprite,
    reset: resetSprite,
  } = useSpriteCompiler();

  const { refetch: refetchLibrary, sprites: librarySprites, setVersionLabel, deleteVersion, updateContent } = useLibrary(!!currentUser);

  // ── UI state ────────────────────────────────────────────────
  const [mode, setMode] = useState<CompilerMode>("new");
  const [baseSpriteFile, setBaseSpriteFile] = useState<File | null>(null);
  const [baseSpriteSource, setBaseSpriteSource] = useState<
    "library" | "uploaded" | null
  >(null);
  // Version of the loaded base sprite, when it came from the library. `null` means "unknown" (uploaded file or no file). Surfaced in the ExistingSpriteSection so the user can see which library version they're editing.
  const [baseSpriteVersion, setBaseSpriteVersion] = useState<
    number | null
  >(null);
  const [activeBundleName, setActiveBundleName] = useState<string>("");
  // Source-bundle hint for the PasteIconsModal. The modal hides any bundle whose name matches this string from its target list, so the user can't accidentally paste the icons back into the very library they just copied them from. We track it as a separate piece of state (instead of reusing `activeBundleName` or `liveDemoSource.name`) because the update-mode `generate()` reset wipes both of those — but the icons in the freshly-generated demo still conceptually came from the loaded library, so the paste popup needs to keep excluding it. Cleared when the user explicitly switches context (loads a different library, uploads a new base sprite from disk, etc.).
  const [pasteExcludeBundleName, setPasteExcludeBundleName] =
    useState<string>("");
  // const [loadingFromLibrary, setLoadingFromLibrary] = useState(false);

  const [inlineSave, setInlineSave] = useState<InlineSaveValue>({
    enabled: false,
    name: "",
    saveAsNew: false,
    hasNameConflict: false,
    isPublic: false,
  });

  const [saving, setSaving] = useState(false);
  const [resultStatusLabel, setResultStatusLabel] = useState<string>("Sprite Generated");
  const pendingFinalizeOptionsRef = useRef<{
    successMessage?: string;
    statusLabel?: string;
    updateVersionInPlace?: boolean;
    versionSpriteId?: string | null;
    versionNumber?: number | null;
  } | null>(null);

  const [pendingConflicts, setPendingConflicts] = useState<IconConflict[] | null>(null);
  const [pendingExistingContent, setPendingExistingContent] = useState<string | null>(null);
  const [conflictResolveBusy, setConflictResolveBusy] = useState<boolean>(false);

  const existingSpriteIds = useMemo<ReadonlySet<string>>(() => {
    if (!pendingExistingContent) return EMPTY_ID_SET;
    try {
      return new Set(
        extractSymbolsFromSprite(pendingExistingContent).map((s) => s.id),
      );
    } catch {
      return EMPTY_ID_SET;
    }
  }, [pendingExistingContent]);
  const [addIconsTargetVersionId, setAddIconsTargetVersionId] = useState<string | null>(null);
  const [addIconsTargetVersionNumber, setAddIconsTargetVersionNumber] = useState<number | null>(null);

  // Live demo modal. Opened from the Results panel's "Live Demo" button. When the modal mutates the sprite, it calls `onUpdate` which we wire to the demo preview buffer (demoSpriteXml / demoSymbolIds) only — the compiler's main result state (spriteXml / symbolIds / spriteUrl) is intentionally left untouched so the Results panel does NOT appear as a side effect of a preview-only rename / delete. The `source` tells the modal whether the "Save Changes" CTA should appear (only when the sprite came from a library version).
  const [liveDemoOpen, setLiveDemoOpen] = useState(false);
  const [liveDemoSource, setLiveDemoSource] = useState<LiveDemoSource>({ type: "scratch" });
  // Tracks which entry point opened the LiveDemo. Set to "preview" when the user clicks the eye icon on a library row — that is the only flow where the LiveDemo exposes a "Save Changes" button (which persists edits back to the same library version) instead of the default "Save to Library" button. Reset to "default" on close so the next open falls back to the standard behaviour unless the eye icon was clicked again.
  const [liveDemoMode, setLiveDemoMode] = useState<"default" | "preview">("default");
  // Marks the base-sprite "Preview" button in ExistingSpriteSection as the opener's source. Independent of `liveDemoMode` so the base-sprite preview keeps the default "Save to Library" CTA (revert from the previous "Save Changes" experiment) while still preventing its rename/delete edits from leaking into the compiler's main result state via `onUpdate`. Only the library panel eye icon sets `liveDemoMode = "preview"` to expose the in-place "Save Changes" button; the base-sprite preview sets ONLY this flag. Both preview entry points are combined in the `onUpdate` gate below.
  const [liveDemoIsBaseSpritePreview, setLiveDemoIsBaseSpritePreview] =
    useState<boolean>(false);
  // Set to `true` by `handleOpenSaveSelectedToLibrary` BEFORE the LiveDemo's `onClose` callback fires. The close handler in JSX checks this ref and skips the `setDemoSpriteXml(null)` / `setDemoSymbolIds([])` reset when it is true — otherwise the just-set selected-only XML/ids would be wiped on close, and `handleSaveToLibraryConfirm` (which reads from `demoSpriteXml`) would fall back to the FULL main `spriteXml` and save all icons instead of just the selected ones. Reset to `false` once the close handler has run so the next normal close behaves as before.
  const preserveDemoStateOnCloseRef = useRef<boolean>(false);
  // Set to `true` by `handleOpenSaveSelectedToLibrary` when it seeds `demoSpriteXml` with the selected-only sprite. The save modal's close handlers (both Cancel and the post-save success path) check this ref and, when true, clear `demoSpriteXml` / `demoSymbolIds` so re-opening the LiveDemo falls back to the FULL main `spriteXml` / `symbolIds` instead of showing the stale 2-icon subset that was used for the save. Without this, after a "Save Selected" flow the LiveDemo would only ever display the icons the user selected, even after the user cancels or successfully saves and re-opens it.
  const saveModalOpenedFromSelectionRef = useRef<boolean>(false);
  const [demoSpriteXml, setDemoSpriteXml] = useState<string | null>(null);
  const [demoSymbolIds, setDemoSymbolIds] = useState<string[]>([]);

  useEffect(() => {
    if (!spriteXml) return;
    setDemoSpriteXml(spriteXml);
    setDemoSymbolIds(symbolIds);
  }, [spriteXml, symbolIds]);

  // "Paste Icons To..." modal. Lives at the Compiler level (not inside the LiveDemo) so we can close the LiveDemo the moment the paste popup opens — per UX request. The LiveDemo's "Copy N Selected" footer button calls `onCopySelectedRequest(icons)` to push the payload up here, and we open the modal on top. When the user picks a target the modal calls our `handlePasteIntoWorkspace` / `handlePasteIntoLibraryVersion` (already defined below) and auto-closes itself.
  const [pendingPasteIcons, setPendingPasteIcons] =
    useState<CopiedIcon[] | null>(null);
  const [pasteBusy, setPasteBusy] = useState<boolean>(false);

  // Open the paste modal at the Compiler level. Called from the LiveDemo's "Copy N Selected" footer button via `onCopySelectedRequest`. Closes the live demo so the user lands on a clean canvas while they pick a paste target.
  function openPasteModal(icons: CopiedIcon[]): void {
    setPendingPasteIcons(icons);
    setLiveDemoOpen(false);
  }

  function closePasteModal(): void {
    if (pasteBusy) return;
    setPendingPasteIcons(null);
  }

  function handleGuestSaveChanges(input: {
    xml: string;
    symbolIds: string[];
  }): void {
    if (!input.xml) return;
    if (liveDemoSource.type === "baseSprite") {
      try {
        const fileName = baseSpriteFile?.name || "sprite.svg";
        const mimeType =
          baseSpriteFile?.type || "image/svg+xml";
        const newFile = new File([input.xml], fileName, { type: mimeType });
        setBaseSpriteFile(newFile);
        setDemoSpriteXml(input.xml);
        setDemoSymbolIds(input.symbolIds);
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : "Failed to apply the preview edits.",
          "error",
        );
      }
      return;
    }
    if (input.xml !== spriteXml) {
      loadFromLibrary({ xml: input.xml, symbolIds: input.symbolIds });
    }
  }

  // Custom-CSS state shared with the live demo. The state is held in a single "preview" buffer that mirrors whatever the user is currently looking at. The buffer is seeded: from the saved library's CSS when the user opens that library's preview, or from the default CSS when the user opens a fresh scratch compile. While the user is tweaking the demo, only the preview buffer is updated — the source library's stored CSS is never touched. The new CSS is only persisted back to a library key when the user explicitly clicks Save to Library, at which point we copy the preview buffer to the newly-created library's key. The previously-loaded library keeps its original CSS untouched.
  const defaultCssState: LiveDemoCssState = {
    iconSize: 24,
    activeColorClass: "text-slate-700",
    activeCustomColor: null,
    activeGradient: null,
    useGradient: false,
    gradientStart: "#f43f5e",
    gradientEnd: "#fb923c",
    customColor: "#ff0055",
  };
  // The preview buffer the live demo reads from / writes to. `null` means "not seeded yet" — the consumer falls back to `defaultCssState` until something populates it.
  const [demoPreviewCssState, setDemoPreviewCssState] =
    useState<LiveDemoCssState | null>(null);
  // Per-library CSS state, keyed by `library:<spriteId>`. The live demo never writes here directly — only the save flow does, when the user commits a new library to the server.
  const [libraryCssState, setLibraryCssState] = useState<
    Record<string, LiveDemoCssState>
  >({});
  // Tracks the source the preview buffer was last seeded from, so re-opening the same library doesn't blow away the user's in-progress tweaks. Compared by id+version so a saved update to the same library (e.g. after refresh) re-seeds correctly.
  const lastSeededSourceKeyRef = useRef<string | null>(null);
  // What the live demo currently sees / mutates. Reads from `demoPreviewCssState` (with a default fallback) so the tweaks land in the scratch buffer, not in the source library's record.
  const activeDemoCssState: LiveDemoCssState =
    demoPreviewCssState ?? defaultCssState;
  const setActiveDemoCssState = (next: LiveDemoCssState) => {
    setDemoPreviewCssState(next);
  };
  // Stable key for a source so we can compare it across renders and dedupe seed calls.
  function sourceKey(source: LiveDemoSource): string {
    if (source.type === "library") {
      return `library:${source.id}:${source.version ?? 0}`;
    }
    return "scratch";
  }
  // Seed the preview buffer from a library's stored CSS (or from defaults for a fresh scratch compile). Called by the LibraryPanel's eye button, the Load-to-Update flow, and the Results panel's Live Demo button. Re-seeds only when the source actually changes — re-opening the same library preserves the user's in-progress tweaks.
  function seedPreviewFromSource(source: LiveDemoSource) {
    const key = sourceKey(source);
    if (lastSeededSourceKeyRef.current === key) return;
    lastSeededSourceKeyRef.current = key;
    if (source.type === "library") {
      const stored = libraryCssState[`library:${source.id}`];
      setDemoPreviewCssState(stored ?? defaultCssState);
    } else {
      setDemoPreviewCssState(defaultCssState);
    }
  }

  // User guide drawer.
  const [guideOpen, setGuideOpen] = useState(false);

  // "Save to Library" modal (lives at the Compiler level so it can talk to the live demo + the library list). Opens from the live demo's "Save to Library" button.
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalName, setSaveModalName] = useState<string>("");
  // The placeholder shown inside the Library Name field when it's empty. Computed at open time so the user always sees a date-stamped default like "New sprite 7/15/2026". When the user submits an empty field we fall back to this value so the save still succeeds.
  const [saveModalPlaceholder, setSaveModalPlaceholder] = useState<string>("");
  const [saveModalNextVersion, setSaveModalNextVersion] = useState<number>(1);
  // Initial value of the modal's "Make it as public" toggle. Seeded from the currently-loaded library's `isPublic` flag when the modal opens, so saving a new version of an existing bundle keeps the same visibility; falls back to `false` (private) for new bundles.
  const [saveModalIsPublic, setSaveModalIsPublic] = useState<boolean>(false);
  const [saveModalBusy, setSaveModalBusy] = useState(false);

  // Returns the next version the server will assign for a given bundle name. We scan the in-memory library list (sorted newest-first by the panel) and add one. If the bundle doesn't exist yet, this returns 1.
  function resolveNextVersionFor(name: string): number {
    const key = name.trim().toLowerCase();
    if (!key) return 1;
    const latest = librarySprites
      .filter(
        (sprite) => (sprite.bundleName || sprite.name || "").trim().toLowerCase() === key,
      )
      .reduce<number>((max, sprite) => Math.max(max, sprite.version ?? 0), 0);
    return latest + 1;
  }

  function openSaveToLibraryModal(input: { suggestedName: string }) {
    // Per UX request, the modal always opens with an EMPTY Library Name field. We compute a date-stamped default and pass it as the input placeholder so the user sees a sensible hint without us actually pre-filling the field. When the user submits an empty value we fall back to the placeholder so the save still succeeds.
    void input;
    const placeholder = "New sprite " + new Date().toLocaleDateString();
    setSaveModalName("");
    setSaveModalPlaceholder(placeholder);
    setSaveModalNextVersion(1);
    // Seed the public toggle from the currently-loaded library so "save v4 of my public library" stays public by default. For a fresh compile (no active bundle) it stays private.
    const activeSummary = activeBundleName
      ? librarySprites.find(
          (s) =>
            (s.bundleName || s.name || "").trim().toLowerCase() ===
            activeBundleName.trim().toLowerCase(),
        )
      : undefined;
    setSaveModalIsPublic(!!activeSummary?.isPublic);
    // Close the live demo so the user can interact with the "Save to Organization" form on a clean canvas. The modal remembers the sprite via `demoSpriteXml`/`demoSymbolIds`, so re-opening will rehydrate it.
    setLiveDemoOpen(false);
    setSaveModalOpen(true);
  }
  function handleOpenSaveSelectedToLibrary(icons: CopiedIcon[]) {
    if (!icons || icons.length === 0) return;
    const selectedSymbols = icons
      .map((icon) => {
        const match = icon.rawSymbol.match(
          /<symbol\s+id="([^"]+)"\s+viewBox="([^"]+)"\s*>([\s\S]*?)<\/symbol>/,
        );
        const id = match?.[1] ?? icon.name;
        const viewBox = match?.[2] ?? "0 0 24 24";
        const inner = match?.[3] ?? "";
        return { id, viewBox, inner };
      })
      // De-duplicate by id (the user could in theory select the same id twice via the API) so the saved sprite never contains duplicate symbol definitions.
      .filter((symbol, index, arr) => arr.findIndex((s) => s.id === symbol.id) === index);
    if (selectedSymbols.length === 0) {
      showToast("No icons available to save.", "warning");
      return;
    }
    const xml = buildSpriteXml(selectedSymbols);
    const ids = selectedSymbols.map((s) => s.id);
    // Seed the demo preview buffer with the selected-only sprite. `handleSaveToLibraryConfirm` reads from `demoSpriteXml` first, so this is what ends up in the saved library. The compiler's main `spriteXml` and `symbolIds` stay untouched, so the Results panel and the staged list are not affected.
    setDemoSpriteXml(xml);
    setDemoSymbolIds(ids);
    // Mark the upcoming close as "preserve demo state" so the LiveDemo's `onClose` callback doesn't wipe the selected-only XML we just set. Without this, `handleSaveToLibraryConfirm` would fall back to the full main `spriteXml` and save every icon instead of just the selected ones. Cleared inside the close handler in JSX after the reset is skipped.
    preserveDemoStateOnCloseRef.current = true;
    // Mark the upcoming save-modal close (whether Cancel or post-save success) so it clears the demo state and re-opening the LiveDemo falls back to the full main `spriteXml`. Reset inside the save modal's close handlers (see `onClose` on `<SaveToLibraryModal>` and the success path of `handleSaveToLibraryConfirm`).
    saveModalOpenedFromSelectionRef.current = true;
    const placeholder =
      `Selected ${ids.length} icon${ids.length === 1 ? "" : "s"} ` +
      new Date().toLocaleDateString();
    setSaveModalName("");
    setSaveModalPlaceholder(placeholder);
    setSaveModalNextVersion(1);
    // Selected-only saves always start private — the user opted into "save selected", not "publish selected", and the visibility toggle is the only place they can override that default.
    setSaveModalIsPublic(false);
    setLiveDemoOpen(false);
    setSaveModalOpen(true);
  }

  async function handleSaveToLibraryConfirm(input: { name: string; version: string; isPublic: boolean }) {
    if (saveModalBusy) return;
    // The bundle name is exactly what the user typed, OR the placeholder when the field was left empty. The version description is a human label for this save (e.g. "v3" or "Added 5 new icons") and is included as the per-sprite `name`; the server still auto-increments the numeric version under the same bundle, so each save appears as a new row in the library panel.
    const targetBundle = input.name.trim() || saveModalPlaceholder.trim();
    setSaveModalBusy(true);
    try {
      const xml = demoSpriteXml ?? spriteXml;
      const ids = demoSpriteXml ? demoSymbolIds : symbolIds;
      if (!xml) {
        showToast("Nothing to save yet.", "warning");
        return;
      }
      const saved = await saveSprite({
        // Per-sprite label. The server overrides this with "<bundle> v<N>", so we fall back to the bundle name when the description is empty.
        name: input.version.trim() ? `${targetBundle} ${input.version.trim()}` : targetBundle,
        bundleName: targetBundle,
        xml,
        symbolIds: ids,
        symbolCount: ids.length,
        // Visibility is chosen in the modal — `true` makes the new bundle / version visible to every signed-in user, `false` keeps it private to the current owner.
        isPublic: input.isPublic,
      });
      setActiveBundleName(saved.bundleName);
      // Track the freshly-saved bundle as the paste-exclude hint so a copy-from-demo on this generated sprite hides the just-saved library from the paste popup.
      if (saved.bundleName) {
        setPasteExcludeBundleName(saved.bundleName);
      }
      // Commit the in-progress preview buffer to the newly-saved library's key. This is the ONLY place a library's stored CSS is written — the live demo never mutates it directly, so the previously-loaded library's CSS stays untouched. When the user later re-opens the new library's preview, `seedPreviewFromSource` copies this entry back into the preview buffer.
      setLibraryCssState((prev) => ({
        ...prev,
        [`library:${saved.id}`]: activeDemoCssState,
      }));
      // Pin the user-typed version description onto the local summary so the library panel shows "v4" (or whatever the user typed) in the version pill, not the server's numeric "v1". Must be set BEFORE refetchLibrary, because refetch wipes the local list and the label cache re-applies it.
      const label = input.version.trim();
      if (label) {
        setVersionLabel(saved.id, label);
      }
      // Await the refetch so the library list shows the new version immediately. Without this the user would have to hit the refresh button to see the saved entry.
      await refetchLibrary();
      // Broadcast to every other `useLibrary` instance (e.g. the LibraryPanel) so they also refetch and show the new entry without the user clicking the refresh button.
      notifyLibraryChanged();
      // Recompute the next version so the modal, if reopened, defaults to the new "v4" (or whatever).
      setSaveModalNextVersion(resolveNextVersionFor(saved.bundleName));
      showToast(
        `Saved "${truncateLibName(saved.bundleName)}" v${saved.version} to your library.`,
        "success"
      );
      setSaveModalOpen(false);
      // If the save modal was opened from the "Save Selected" flow, drop the selected-only demo state so re-opening the LiveDemo falls back to the full main `spriteXml` / `symbolIds` instead of the stale 2-icon subset. Reset the ref so the next normal save (no selection) is unaffected.
      if (saveModalOpenedFromSelectionRef.current) {
        saveModalOpenedFromSelectionRef.current = false;
        setDemoSpriteXml(null);
        setDemoSymbolIds([]);
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save sprite.",
        "error"
      );
    } finally {
      setSaveModalBusy(false);
    }
  }

  function handlePasteIntoWorkspace(icons: CopiedIcon[]) {
    if (!icons || icons.length === 0) return;
    // De-duplicate by name against the currently-staged files so the user doesn't end up with two rows for the same icon if they paste the same selection twice. We compare by basename (since every File the dropzone stores has its own name) and by the source symbol id, so a paste that targets the same icon from a different selection set is treated as a refresh, not a duplicate.
    const stagedNames = new Set(files.map((f) => f.name));
    const newFiles: File[] = [];
    for (const icon of icons) {
      const fileName = `${icon.name}.svg`;
      if (stagedNames.has(fileName)) continue;
      stagedNames.add(fileName);
      const file = new File([icon.content], fileName, { type: "image/svg+xml" });
      newFiles.push(file);
    }
    if (newFiles.length === 0) {
      showToast(
        `All ${icons.length} icon${icons.length === 1 ? "" : "s"} already staged.`,
        "warning",
      );
      return;
    }
    appendFiles(newFiles);
    // Snapshot the just-pasted files so the Undo action can pull them back out by reference later, even after the user adds or removes other files in the staging area.
    const pastedSnapshot = newFiles.slice();
    const count = newFiles.length;
    showToast(
      `Pasted ${count} icon${count === 1 ? "" : "s"} into the workspace.`,
      "success",
      [
        {
          label: "Preview",
          type: "secondary",
          onClick: () => {
            // Generate a sprite from the just-pasted files and open the live demo on it. The user lands on the same "scratch" view the Results panel uses after a fresh compile, but pre-loaded with the pasted icons. The compiler's main `spriteXml` is left untouched so the Results panel and the existing library state aren't disturbed.
            generateFromFiles(pastedSnapshot, { openDemoOnDone: true });
          },
        },
        {
          label: "Undo",
          type: "primary",
          onClick: () => {
            removeFiles(pastedSnapshot);
            showToast(
              `Removed ${count} pasted icon${count === 1 ? "" : "s"} from the workspace.`,
              "success"
            );
          },
        },
      ]
    );
  }

  // Paste icons into a library. Loads the latest version of the bundle, merges the new symbols into it (new symbols win on id collision), and saves as a new version. After the save succeeds we surface a Preview / Undo toast so the user can roll the paste back if it wasn't what they wanted.
  async function handlePasteIntoLibraryVersion(input: {
    spriteId: string;
    bundleName: string;
    icons: CopiedIcon[];
  }) {
    const detail = await getSpriteById(input.spriteId);
    const baseSymbols = extractSymbolsFromSprite(detail.xml);
    const baseIds = new Set(baseSymbols.map((s) => s.id));
    // Split the pasted selection into "already in the destination" vs "new". The pasted icons keep their declared order so the resulting toast / Preview / Undo text still refers to them in the order the user picked them.
    const duplicateIcons = input.icons.filter((icon) => baseIds.has(icon.name));
    const newIcons = input.icons.filter((icon) => !baseIds.has(icon.name));
    if (newIcons.length === 0) {
      // Every pasted id already exists in the destination — bail out without saving a new version. The user gets a warning toast that names the bundle so they know which library rejected the paste.
      showToast(
        `Selected icon(s) already exist in ${truncateLibName(detail.bundleName)}, No version created.`,
        "warning"
      );
      return;
    }
    const newSymbols = newIcons.map((icon) => {
      // Re-parse the raw symbol so we get the same SpriteSymbol shape the compiler uses.
      const match = icon.rawSymbol.match(
        /<symbol\s+id="([^"]+)"\s+viewBox="([^"]+)"\s*>([\s\S]*?)<\/symbol>/,
      );
      const id = match?.[1] ?? icon.name;
      const viewBox = match?.[2] ?? "0 0 24 24";
      const inner = match?.[3] ?? "";
      return { id, viewBox, inner };
    });
    const seen = new Set<string>();
    const merged = [...baseSymbols, ...newSymbols].filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    const sortedMerged = sortSymbolsById(merged);
    const xml = buildSpriteXml(sortedMerged);
    const saved = await saveSprite({
      name: detail.bundleName,
      bundleName: detail.bundleName,
      xml,
      symbolIds: sortedMerged.map((s) => s.id),
      symbolCount: sortedMerged.length,
      isPublic: detail.isPublic,
    });
    await refetchLibrary();
    // Broadcast to every other `useLibrary` instance so the LibraryPanel shows the new pasted-into-library version without a manual refresh.
    notifyLibraryChanged();
    const pastedCount = newIcons.length;
    const duplicateCount = duplicateIcons.length;
    const newSpriteId = saved.id;
    const newVersion = saved.version;
    const bundleName = detail.bundleName;
    const previewXml = xml;
    const previewIds = sortedMerged.map((s) => s.id);
    const successMessage =
      duplicateCount > 0
        ? `Pasted ${pastedCount} icon${pastedCount === 1 ? "" : "s"} into ${truncateLibName(bundleName)} v${newVersion} (skipped ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"}).`
        : `Pasted ${pastedCount} icon${pastedCount === 1 ? "" : "s"} into ${truncateLibName(bundleName)} v${newVersion}.`;
    showToast(
      successMessage,
      "success",
      [
        {
          label: "Preview",
          type: "secondary",
          onClick: () => {
            // Open the live demo loaded with the just-pasted version so the user can see exactly what they committed. Seeded as a library source so the modal's existing UI (Save to Library etc.) lines up with what they see in the panel.
            setDemoSpriteXml(previewXml);
            setDemoSymbolIds(previewIds);
            setLiveDemoSource({
              type: "library",
              id: newSpriteId,
              name: bundleName,
              version: newVersion,
              isOwner: true,
              isPublic: !!detail.isPublic,
            });
            // Force a re-seed of the preview buffer for this (new) library id so the modal opens with the right CSS.
            lastSeededSourceKeyRef.current = null;
            seedPreviewFromSource({
              type: "library",
              id: newSpriteId,
              name: bundleName,
              version: newVersion,
              isOwner: true,
              isPublic: !!detail.isPublic,
            });
            setLiveDemoOpen(true);
          },
        },
        {
          label: "Undo",
          type: "primary",
          onClick: async () => {
            try {
              await deleteVersion(newSpriteId);
              notifyLibraryChanged();
              showToast(
                `Removed ${bundleName} v${newVersion}.`,
                "success"
              );
            } catch (err) {
              showToast(
                err instanceof Error
                  ? err.message
                  : "Failed to undo paste.",
                "error"
              );
            }
          },
        },
      ]
    );
  }

  // Build a sprite from a specific list of staged files and (optionally) open the live demo on the result. Used by the "Preview" action on the workspace paste toast. We do NOT push the pasted files into the dropzone first — instead we build a sprite XML directly from the pasted payload (the `CopiedIcon.content` is already a self-contained standalone SVG) so the user can preview without disturbing the existing staging list. The demo reads `demoSpriteXml` when it's set, so seeding that with the previewed XML keeps the compiler's `spriteXml` (and the Results panel) untouched.
  function generateFromFiles(
    inputFiles: File[],
    options: { openDemoOnDone: boolean }
  ): void {
    if (inputFiles.length === 0) return;
    // Read the staged files in parallel so we can assemble a fresh sprite without round-tripping through the compiler's `generate()` pipeline (which would overwrite the existing `spriteXml`).
    Promise.all(inputFiles.map((f) => f.text()))
      .then((xmls) => {
        const parser = new DOMParser();
        const symbols: { id: string; viewBox: string; inner: string }[] = [];
        for (const xml of xmls) {
          const doc = parser.parseFromString(xml, "image/svg+xml");
          if (doc.querySelector("parsererror")) continue;
          const svg = doc.querySelector("svg");
          if (!svg) continue;
          const viewBox = svg.getAttribute("viewBox") || "0 0 24 24";
          // Pull every child of the <svg> into a single <symbol> wrapper. We use the file name (sans extension) as the symbol id, falling back to a numeric suffix when two files share a name. The resulting id is always prefixed with `icon-` so references render as `#icon-<name>`.
          const rawName =
            svg.getAttribute("id") ||
            inputFiles[xmls.indexOf(xml)]?.name.replace(/\.svg$/i, "") ||
            `icon-${symbols.length + 1}`;
          const baseName = rawName.startsWith("icon-")
            ? rawName
            : `icon-${rawName}`;
          const inner = Array.from(svg.childNodes)
            .map((node) => (node as Element).outerHTML ?? "")
            .join("");
          // Skip duplicates by id so the preview sprite mirrors the dedup behaviour of the actual paste-into-workspace flow.
          if (symbols.some((s) => s.id === baseName)) continue;
          symbols.push({ id: baseName, viewBox, inner });
        }
        if (symbols.length === 0) return;
        const sortedSymbols = sortSymbolsById(symbols);
        const xml = buildSpriteXml(sortedSymbols);
        setDemoSpriteXml(xml);
        setDemoSymbolIds(sortedSymbols.map((s) => s.id));
        setLiveDemoSource({ type: "scratch" });
        // Force a re-seed of the preview buffer for scratch mode so the modal opens with the right CSS.
        lastSeededSourceKeyRef.current = null;
        seedPreviewFromSource({ type: "scratch" });
        if (options.openDemoOnDone) {
          setLiveDemoOpen(true);
        }
      })
      .catch(() => {
        showToast("Failed to preview the pasted icons.", "error");
      });
  }

  // Build + download an SVG sprite bundle (sprite + demo.html + preview.png) wrapped in a zip. Used by the Results panel's "Download zip" button and by the live demo's logged-out "Save" button — both call the same builder so the bundle contents are identical regardless of the entry point.
  const [resultsDownloadBusy, setResultsDownloadBusy] = useState(false);
  async function buildAndDownloadBundle(input: {
    xml: string;
    ids: string[];
    fileName: string;
    // Optional identifying info for the success toast. When supplied, the toast tells the user which bundle + version they just downloaded. Falls back to a generic message when missing (e.g. an ad-hoc scratch compile).
    bundleName?: string;
    version?: number;
  }): Promise<boolean> {
    const { xml, ids, fileName, bundleName, version } = input;
    if (!xml) return false;
    const demoHtml = buildDemoHtml(ids, xml);
    const previewPng = await renderSpritePreviewPng(xml, ids);
    const entries: { name: string; data: string | Uint8Array }[] = [
      { name: `${fileName}.svg`, data: xml },
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
    // Surface the bundle + version in the success toast so the user knows exactly what they just downloaded. Logged-out users (or scratch compiles) have no bundle context, so we fall back to a generic message instead of printing raw "undefined" tokens.
    if (bundleName && version != null) {
      showToast(
        `Sprite bundle ${truncateLibName(bundleName)} (v${version}) downloaded successfully.`,
        "success",
      );
    } else {
      showToast("Sprite bundle downloaded successfully.", "success");
    }
    return true;
  }
  async function handleDownloadBundleForResults() {
    if (resultsDownloadBusy) return;
    const xml = spriteXml;
    if (!xml) {
      showToast("No sprite to export.", "warning");
      return;
    }
    setResultsDownloadBusy(true);
    try {
      const sourceBundle =
        liveDemoSource.type === "library"
          ? liveDemoSource.name
          : activeBundleName || undefined;
      const sourceVersion =
        liveDemoSource.type === "library"
          ? liveDemoSource.version
          : undefined;
      await buildAndDownloadBundle({
        xml,
        ids: symbolIds,
        fileName: (baseSpriteFile?.name || "sprite").replace(/\.svg$/i, ""),
        bundleName: sourceBundle,
        version: sourceVersion,
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to build bundle.",
        "error",
      );
    } finally {
      setResultsDownloadBusy(false);
    }
  }
  // Logged-out "Save" inside the live demo modal — uses the shared builder with the demo's currently-previewed XML (or the freshly-generated sprite if no preview is open).
  async function handleDownloadBundleForDemo() {
    const xml = demoSpriteXml ?? spriteXml;
    if (!xml) {
      showToast("No sprite to export.", "warning");
      return;
    }
    await buildAndDownloadBundle({
      xml,
      ids: demoSpriteXml ? demoSymbolIds : symbolIds,
      fileName: (baseSpriteFile?.name || "sprite").replace(/\.svg$/i, ""),
      bundleName:
        liveDemoSource.type === "library"
          ? liveDemoSource.name
          : activeBundleName || undefined,
      version:
        liveDemoSource.type === "library"
          ? liveDemoSource.version
          : undefined,
    });
  }

  // Existing bundle names (lowercased) for the inline save conflict check.
  const existingLibraryNames = useMemo(() => {
    const set = new Set<string>();
    for (const sprite of librarySprites) {
      const key = (sprite.bundleName || sprite.name || "").trim().toLowerCase();
      if (key) set.add(key);
    }
    return Array.from(set);
  }, [librarySprites]);

  function handleSaveToLibraryToggle(next: boolean) {
    if (next && !currentUser) {
      showToast("Please login to save to a library.", "warning");
      onRequireAuth?.();
      return;
    }
    if (next) {
      const baseName =
        mode === "update" && activeBundleName
          ? activeBundleName
          : baseSpriteFile
            ? baseSpriteFile.name.replace(/\.svg$/i, "")
            : "New Sprite " + new Date().toLocaleDateString();
      const candidate = inlineSave.name || baseName;
      const candidateKey = candidate.trim().toLowerCase();
      const isActiveBundle = activeBundleName && candidateKey === activeBundleName.trim().toLowerCase();
      setInlineSave((current) => ({
        ...current,
        enabled: true,
        name: candidate,
        saveAsNew: current.saveAsNew && !isActiveBundle,
        hasNameConflict: existingLibraryNames.includes(candidateKey) && !isActiveBundle,
        isPublic: current.isPublic,
      }));
    } else {
      setInlineSave((current) => ({ ...current, enabled: false }));
    }
  }

  const hasFiles = files.length > 0;
  const hasResult = spriteXml !== null;
  const trimmedName = inlineSave.name.trim();

  // ── Mode switcher side-effects ─────────────────────────────
  // Default toggle state per mode. The "Save to library" toggle is OFF in both modes — a fresh compile has nothing to save yet, and entering the Update tab starts the user in the same "decide later" posture. The user is the only one who can flip the toggle on; we never auto-enable it on tab switch. Anything they did before is wiped on mode change.
  const defaultInlineSave: InlineSaveValue = {
    enabled: false,
    name: "",
    saveAsNew: false,
    hasNameConflict: false,
    isPublic: false,
  };
  function changeMode(next: CompilerMode) {
    setMode(next);
    if (next === "new") {
      setBaseSpriteFile(null);
      setBaseSpriteSource(null);
      setBaseSpriteVersion(null);
      setActiveBundleName("");
      setLiveDemoSource({ type: "scratch" });
      // The "new" tab starts with no source library, so the paste popup shouldn't be hiding any bundle.
      setPasteExcludeBundleName("");
      // Reset the preview buffer too so the new compile starts from a clean custom-CSS slate, not a stale preview.
      setDemoPreviewCssState(null);
      lastSeededSourceKeyRef.current = null;
      setAddIconsTargetVersionId(null);
      setAddIconsTargetVersionNumber(null);
    } else if (next === "update" && mode !== "update") {
      // Entering the "Update Existing Sprite" tab. Reset the inline-save state to its default so the toggle starts OFF and the Library Name input starts empty. The user's explicit choice in the previous tab does not carry over — switching tabs is a navigation action, and the "Save to library" intent is something the user should re-confirm for the new mode.
    }
    // Always restore the toggle to its per-mode default when switching tabs. This keeps the "Save to library" toggle in the OFF position in both Create and Update modes, and clears the Library Name field so the user starts from a clean slate.
    setInlineSave(defaultInlineSave);
  }

  function clearExistingSprite() {
    setBaseSpriteFile(null);
    setBaseSpriteSource(null);
    setBaseSpriteVersion(null);
    setActiveBundleName("");
    setLiveDemoSource({ type: "scratch" });
    // No base sprite means no source bundle to hide from the paste popup either.
    setPasteExcludeBundleName("");
    setDemoPreviewCssState(null);
    lastSeededSourceKeyRef.current = null;
    // Clearing the base sprite is a navigation away from the prior compile context, so the in-place tracker no longer applies.
    setAddIconsTargetVersionId(null);
    setAddIconsTargetVersionNumber(null);
    setInlineSave((current) => ({
      ...current,
      enabled: false,
      name: "",
      saveAsNew: false,
      hasNameConflict: false,
      isPublic: false,
    }));
  }
  async function handlePreviewBaseSprite() {
    if (!baseSpriteFile) {
      showToast("Upload a sprite.svg first.", "warning");
      return;
    }
    try {
      const xml = await baseSpriteFile.text();
      const symbols = extractSymbolsFromSprite(xml);
      if (symbols.length === 0) {
        showToast(
          "No <symbol> elements found in this sprite. The Live Demo needs a sprite with at least one symbol.",
          "warning",
        );
        return;
      }
      setLiveDemoIsBaseSpritePreview(true);
      const sortedSymbols = sortSymbolsById(symbols);
      const demoXml = buildSpriteXml(sortedSymbols);
      setDemoSpriteXml(demoXml);
      setDemoSymbolIds(sortedSymbols.map((s) => s.id));
      setLiveDemoSource(
        baseSpriteSource === "library"
          ? {
              type: "baseSprite",
              name:
                (liveDemoSource.type === "library"
                  ? liveDemoSource.name
                  : activeBundleName) || undefined,
              version:
                liveDemoSource.type === "library"
                  ? liveDemoSource.version
                  : baseSpriteVersion ?? undefined,
              isPublic:
                liveDemoSource.type === "library"
                  ? liveDemoSource.isPublic
                  : undefined,
            }
          : { type: "baseSprite" }
      );
      if (baseSpriteSource === "library") {
        const existing =
          liveDemoSource.type === "library" ? liveDemoSource : null;
        const resolvedName = existing?.name ?? activeBundleName;
        if (resolvedName) {
          setPasteExcludeBundleName(resolvedName);
        }
      } else {
        setPasteExcludeBundleName("");
      }
      lastSeededSourceKeyRef.current = null;
      setDemoPreviewCssState(null);
      setLiveDemoOpen(true);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to read the base sprite.",
        "error",
      );
    }
  }

  async function finalizeGenerate(
    summary: {
      duplicateCount: number;
      newCount: number;
      allDuplicates: boolean;
    },
    options?: { successMessage?: string; statusLabel?: string }
  ): Promise<void> {
    // Lock the Generate button until new files are uploaded.
    setHasGenerated(true);
    if (mode === "update") {
      const sourceBundle =
        activeBundleName ||
        (liveDemoSource.type === "library" ? liveDemoSource.name : "");
      if (sourceBundle) {
        setPasteExcludeBundleName(sourceBundle);
      }
      const previousLibrarySource =
        liveDemoSource.type === "library" ? liveDemoSource : null;
      setBaseSpriteFile(null);
      setBaseSpriteVersion(null);
      setActiveBundleName("");
      if (previousLibrarySource) {
        setLiveDemoSource(previousLibrarySource);
      } else {
        setLiveDemoSource({ type: "scratch" });
      }
      setInlineSave({
        enabled: false,
        name: "",
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: false,
      });
    }

    if (!inlineSave.enabled) {
      const updatedMessage =
        options?.successMessage ||
        (mode === "update" && summary.duplicateCount > 0
          ? `Sprite updated in your browser! (skipped ${summary.duplicateCount} duplicate${summary.duplicateCount === 1 ? "" : "s"})`
          : mode === "update"
            ? "Sprite updated in your browser!"
            : "Sprite generated instantly in your browser!");
      showToast(updatedMessage, "success");
      setResultStatusLabel(options?.statusLabel ?? (mode === "update" ? "Sprite Updated" : "Sprite Generated"));
      return;
    }
    setResultStatusLabel(options?.statusLabel ?? (mode === "update" ? "Sprite Updated" : "Sprite Generated"));

    const { xml, symbolIds: ids } = await waitForSprite();
    if (!xml) return;
    const targetBundle = !inlineSave.saveAsNew && activeBundleName
      ? activeBundleName
      : trimmedName;

    setSaving(true);
    try {
      const saved = await saveSprite({
        name: targetBundle,
        bundleName: targetBundle,
        xml,
        symbolIds: ids,
        symbolCount: ids.length,
        isPublic: inlineSave.isPublic,
      });
      const isNewBundle = !inlineSave.saveAsNew && activeBundleName
        ? false
        : true;
      const successMessage = inlineSave.saveAsNew
        ? "New library saved successfully!"
        : activeBundleName
          ? "New version saved to library successfully!"
          : "Sprite generated and saved to library!";
      showToast(successMessage, "success");
      void refetchLibrary();
      notifyLibraryChanged();
      setActiveBundleName(saved.bundleName);
      if (saved.bundleName) {
        setPasteExcludeBundleName(saved.bundleName);
      }
      setAddIconsTargetVersionId(saved.id);
      setAddIconsTargetVersionNumber(saved.version);
      setInlineSave((current) => ({
        ...current,
        name: "",
        saveAsNew: isNewBundle ? false : current.saveAsNew,
        hasNameConflict: false,
      }));
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save sprite.",
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  // Apply the user's per-conflict resolutions and continue the generate flow. Wired to the conflict modal's "Continue" button.
  async function handleApplyConflictResolutions(
    resolutions: Record<string, ConflictResolution>,
  ): Promise<void> {
    if (!pendingConflicts || !pendingExistingContent) {
      // Defensive — should be unreachable because the modal only renders when both states are set.
      return;
    }
    setConflictResolveBusy(true);
    try {
      const summary = await applyConflictResolutions(
        files,
        { existingContent: pendingExistingContent },
        resolutions,
      );
      setPendingConflicts(null);
      setPendingExistingContent(null);
      const options = pendingFinalizeOptionsRef.current ?? {
        statusLabel: mode === "update" ? "Sprite Updated" : "Sprite Generated",
      };
      pendingFinalizeOptionsRef.current = null;
      if (options.updateVersionInPlace && options.versionSpriteId) {
        const { xml: mergedXml, symbolIds: mergedIds } = await waitForSprite();
        if (!mergedXml) {
          showToast("Failed to read merged sprite.", "error");
          return;
        }
        try {
          await putSprite({
            id: options.versionSpriteId,
            xml: mergedXml,
            symbolIds: mergedIds,
            symbolCount: mergedIds.length,
          });
          notifyLibraryChanged();
          void refetchLibrary();
          setHasGenerated(true);
          setResultStatusLabel(options.statusLabel ?? "Sprite Updated with New Icons");
          const newCount = summary.newCount;
          const versionLabel = options.versionNumber != null ? `v${options.versionNumber}` : "version";
          showToast(
            newCount > 0
              ? `Added ${newCount} icon${newCount === 1 ? "" : "s"} to ${versionLabel}.`
              : options.successMessage ?? "Sprite updated with new icons.",
            "success",
          );
        } catch (err) {
          showToast(
            err instanceof Error
              ? err.message
              : "Failed to update the saved version with new icons.",
            "error",
          );
        }
        return;
      }
      await finalizeGenerate(summary, options);
    } finally {
      setConflictResolveBusy(false);
    }
  }

  function handleCancelConflictModal(): void {
    if (conflictResolveBusy) return;
    setPendingConflicts(null);
    setPendingExistingContent(null);
  }

  async function handleGenerate() {
    if (inlineSave.enabled && !currentUser) {
      showToast("Please sign in to save to a library.", "warning");
      onRequireAuth?.();
      return;
    }
    if (mode === "update" && !baseSpriteFile) {
      showToast("Please pick a base sprite to update.", "warning");
      return;
    }

    let existingContent: string | undefined;
    if (mode === "update" && baseSpriteFile) {
      try {
        existingContent = await baseSpriteFile.text();
      } catch {
        showToast("Failed to read the base sprite.", "error");
        return;
      }
    }

    const summary = await generate(files, existingContent ? { existingContent } : undefined);

    if (summary.needsConfirmation && summary.conflicts && existingContent) {
      pendingFinalizeOptionsRef.current = { statusLabel: mode === "update" ? "Sprite Updated" : "Sprite Generated" };
      setPendingConflicts(summary.conflicts);
      setPendingExistingContent(existingContent);
      return;
    }

    await finalizeGenerate(summary, { statusLabel: mode === "update" ? "Sprite Updated" : "Sprite Generated" });
  }

  const handleClearAll = () => {
    clearFiles();
  };

  async function handleAddIcons(files: File[]) {
    if (!spriteXml) {
      showToast("No sprite generated yet. Generate a sprite before adding icons.", "warning");
      return;
    }
    const acceptedFiles = files.filter(
      (file) =>
        file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg"),
    );
    const rejectedCount = files.length - acceptedFiles.length;
    if (rejectedCount > 0) {
      showToast(
        `${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"} ignored. Only SVG icons are accepted.`,
        "warning",
      );
    }
    if (acceptedFiles.length === 0) {
      return;
    }

    const existingContent = spriteXml;
    const updateVersionInPlace = !!addIconsTargetVersionId;
    const summary = await generate(acceptedFiles, { existingContent });
    if (summary.needsConfirmation && summary.conflicts && existingContent) {
      pendingFinalizeOptionsRef.current = {
        successMessage: "Sprite updated with new icons.",
        statusLabel: "Sprite Updated with New Icons",
        updateVersionInPlace,
        versionSpriteId: addIconsTargetVersionId,
        versionNumber: addIconsTargetVersionNumber,
      };
      setPendingConflicts(summary.conflicts);
      setPendingExistingContent(existingContent);
      return;
    }

    if (updateVersionInPlace && addIconsTargetVersionId) {
      const { xml: mergedXml, symbolIds: mergedIds } = await waitForSprite();
      if (!mergedXml) {
        showToast("Failed to read merged sprite.", "error");
        return;
      }
      try {
        await putSprite({
          id: addIconsTargetVersionId,
          xml: mergedXml,
          symbolIds: mergedIds,
          symbolCount: mergedIds.length,
        });
        notifyLibraryChanged();
        void refetchLibrary();
        setHasGenerated(true);
        setResultStatusLabel("Sprite Updated with New Icons");
        const newCount = summary.newCount;
        const versionLabel =
          addIconsTargetVersionNumber != null
            ? `v${addIconsTargetVersionNumber}`
            : "version";
        showToast(
          newCount > 0
            ? `Added ${newCount} icon${newCount === 1 ? "" : "s"} to ${versionLabel}.`
            : "Sprite updated with new icons.",
          "success",
        );
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : "Failed to update the saved version with new icons.",
          "error",
        );
      }
      return;
    }

    await finalizeGenerate(summary, {
      successMessage: "Sprite updated with new icons.",
      statusLabel: "Sprite Updated with New Icons",
    });
  }

  // ── Library → Update flow ──────────────────────────────────
  async function handleLoadFromLibrary(summary: SpriteSummary) {
    clearFiles();
    resetForNewUpload();
    setMode("update");
    // setLoadingFromLibrary(true);
    try {
      const detail = await getSpriteById(summary._id);
      const bundleName = detail.bundleName || detail.name;
      const isOwner = detail.isOwner !== false; // server defaults to true on writes
      const blob = new Blob([detail.xml], { type: "image/svg+xml" });
      const fileName = bundleName + ".svg";
      const file = new File([blob], fileName, { type: "image/svg+xml" });
      setBaseSpriteFile(file);
      setBaseSpriteSource("library");
      setBaseSpriteVersion(detail.version);
      setActiveBundleName(bundleName);
      setPasteExcludeBundleName(bundleName);

      // The live-demo modal can persist edits directly to this library version via `useLibrary().updateContent`.
      const newSource: LiveDemoSource = {
        type: "library",
        id: detail.id,
        name: bundleName,
        version: detail.version,
        isOwner,
        isPublic: !!detail.isPublic,
      };
      setLiveDemoSource(newSource);
      seedPreviewFromSource(newSource);
      setInlineSave({
        enabled: isOwner,
        name: "",
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: !!detail.isPublic,
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to load sprite from library.",
        "error"
      );
      // Fall back to the previous (partial) behaviour: switch mode and pre-fill the name so the user can still pick a file.
      setMode("update");
      const fallbackBundleName = summary.bundleName || summary.name;
      setActiveBundleName(fallbackBundleName);
      // Mirror the success-path hint so the paste popup hides this library even when the full detail fetch failed.
      if (fallbackBundleName) {
        setPasteExcludeBundleName(fallbackBundleName);
      }
      setBaseSpriteSource("library");
      const fallbackSource: LiveDemoSource = {
        type: "library",
        id: summary._id,
        name: fallbackBundleName,
        version: summary.version,
        isOwner: summary.isOwner !== false,
        isPublic: !!summary.isPublic,
      };
      setLiveDemoSource(fallbackSource);
      seedPreviewFromSource(fallbackSource);
      setInlineSave({
        enabled: summary.isOwner !== false,
        name: "",
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: !!summary.isPublic,
      });
    } finally {
      // setLoadingFromLibrary(false);
    }
  }

  function handleSelectFromLibrary() {
    if (!currentUser) {
      onRequireAuth?.();
      return;
    }
    setSelectFromLibraryOpen(true);
  }

  // "Select a sprite from the library" modal. Opened from the "Or select a sprite from the Library" link under the base-sprite uploader. The modal lists the user's libraries as accordions (Public / Private) and lets them pick a specific version; on Load we call the existing `handleLoadFromLibrary` flow so the picked version lands in the base sprite section just like a sidebar Load-to-Update click.
  const [selectFromLibraryOpen, setSelectFromLibraryOpen] = useState(false);
  const [selectFromLibraryBusy, setSelectFromLibraryBusy] = useState(false);

  function closeSelectFromLibrary() {
    if (selectFromLibraryBusy) return;
    setSelectFromLibraryOpen(false);
  }

  async function handleSelectFromLibraryLoad(summary: SpriteSummary) {
    if (selectFromLibraryBusy) return;
    setSelectFromLibraryBusy(true);
    try {
      await handleLoadFromLibrary(summary);
    } finally {
      // The modal already auto-closes on click, but we still flip the busy flag off so a subsequent open starts clean.
      setSelectFromLibraryBusy(false);
    }
  }

  function handleBundleDeleted(name: string) {
    if (activeBundleName && activeBundleName.toLowerCase() === name.toLowerCase()) {
      showToast(`The active library “${name}” was deleted.`, "warning");
      setBaseSpriteFile(null);
      setBaseSpriteVersion(null);
      setActiveBundleName("");
      setLiveDemoSource({ type: "scratch" });
      // Drop the paste-exclude hint too — the bundle is gone, so there's nothing left to hide.
      if (pasteExcludeBundleName && pasteExcludeBundleName.toLowerCase() === name.toLowerCase()) {
        setPasteExcludeBundleName("");
      }
      setDemoPreviewCssState(null);
      lastSeededSourceKeyRef.current = null;
      setAddIconsTargetVersionId(null);
      setAddIconsTargetVersionNumber(null);
      setInlineSave((current) => ({
        ...current,
        enabled: false,
        name: "",
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: false,
      }));
    }
    // Purge any cached CSS for the deleted library so a future save under the same name starts fresh.
    setLibraryCssState((prev) => {
      const next: Record<string, LiveDemoCssState> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (key !== `library:${name}`) next[key] = value;
      }
      return next;
    });
  }

  return (
    <div>
      <div id="appContainer" className="relative flex min-h-screen opacity-100 transition-opacity duration-700 ease-out">
        {currentUser && (
        <LibraryPanel
          isOpen={libraryOpen}
          onCollapseToggle={() => onLibraryToggle(false)}
          onOpenLogin={() => onRequireAuth?.()}
          onLoadToUpdate={handleLoadFromLibrary}
          onOpenDemo={({ sprite, symbolIds, source }) => {
            setDemoSpriteXml(sprite);
            setDemoSymbolIds(symbolIds);
            setLiveDemoSource(source);
            if (source.type === "library") {
              setPasteExcludeBundleName(source.name);
            } else {
              setPasteExcludeBundleName("");
            }
            setLiveDemoMode("preview");
            seedPreviewFromSource(source);
            setLiveDemoOpen(true);
          }}
          onLibraryRenamed={({ oldName, newName }) => {
            if (activeBundleName && activeBundleName.toLowerCase() === oldName.toLowerCase()) {
              setActiveBundleName(newName);
              if (liveDemoSource.type === "library") {
                setLiveDemoSource({ ...liveDemoSource, name: newName });
              }
              if (pasteExcludeBundleName && pasteExcludeBundleName.toLowerCase() === oldName.toLowerCase()) {
                setPasteExcludeBundleName(newName);
              }
              setInlineSave((current) =>
                current.name.trim().toLowerCase() === oldName.toLowerCase()
                  ? { ...current, name: newName }
                  : current
              );
            }
          }}
          onDownloadBundle={async (summary) => {
            const detail = await getSpriteById(summary._id);
            const bundleName = detail.bundleName || detail.name || summary.name;
            await buildAndDownloadBundle({
              xml: detail.xml,
              ids: detail.symbolIds,
              fileName: `${bundleName}-v${detail.version}`,
              bundleName,
              version: detail.version,
            });
          }}
          onLibraryDeleted={({ name }) => handleBundleDeleted(name)}
        />
        )}

        <main className="flex min-h-[calc(100vh-57px)] flex-1 justify-center gap-6 px-4 py-10 sm:py-16">
          <div className="w-full max-w-2xl">
            {!currentUser && <CompilerHeader />}

            <main
              className={`animate-fade-in-up flex-1 rounded-2xl border border-slate-200/60 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8 ${currentUser ? "mt-8" : ""}`}
              style={{ animationDelay: ".08s" }}
            >
              <ModeTabs value={mode} onChange={changeMode} />

              {mode === "update" && (
                <ExistingSpriteSection
                  file={baseSpriteFile}
                  version={baseSpriteVersion}
                  onFile={(f) => {
                    if (f === null) {
                      showToast("Base sprite must be an SVG file.", "error");
                      return;
                    }
                    if (hasGenerated) {
                      resetForNewUpload();
                      clearFiles();
                    }
                    setBaseSpriteFile(f);
                    setBaseSpriteVersion(null);
                    setBaseSpriteSource("uploaded");
                    if (!hasGenerated) {
                      setPasteExcludeBundleName("");
                    }
                    if (!activeBundleName) {
                      const fromName = f.name.replace(/\.svg$/i, "");
                      setActiveBundleName(fromName);
                    }
                    setInlineSave((current) => ({
                      ...current,
                      enabled: false,
                      saveAsNew: false,
                      hasNameConflict: false,
                    }));
                  }}
                  onClear={clearExistingSprite}
                  onSelectFromLibrary={handleSelectFromLibrary}
                  canSelectFromLibrary={!!currentUser}
                  onPreview={handlePreviewBaseSprite}
                  onRejected={(rejected) => {
                    showToast(
                      `${rejected.fileName} is not a sprite file, drop standalone icons in the icon section above.`,
                      "error"
                    );
                  }}
                />
              )}

              {mode === "update" && (
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    2. New Icons to Add
                  </h2>
                  {/* {loadingFromLibrary && (
                    <span className="text-[10px] font-mono text-indigo-500">
                      Loading…
                    </span>
                  )} */}
                </div>
              )}

              <FileDropzone
                inputRef={inputRef}
                onDrop={handleDrop}
                onDragOver={baseOnDragOver}
                onClickBrowse={openPicker}
                onFileChange={handleFileChange}
              />

              {!hasGenerated && (
                <StagedFilesList
                  files={files}
                  onClear={handleClearAll}
                  onRemove={removeAt}
                />
              )}

              <div className="my-6 border-t border-slate-100" />

              <InlineSaveSection
                isVisible={!!currentUser}
                isUpdateMode={mode === "update"}
                isLibrarySource={baseSpriteSource === "library"}
                activeBundleName={activeBundleName}
                existingLibraryNames={existingLibraryNames}
                value={inlineSave}
                onToggle={handleSaveToLibraryToggle}
                onLibraryNameChange={(next) => setInlineSave(next)}
              />

              <GenerateButton
                disabled={
                  hasGenerated ||
                  !hasFiles ||
                  (mode === "update" && !baseSpriteFile) ||
                  (mode !== "update" &&
                    inlineSave.enabled &&
                    trimmedName.length === 0) ||
                  (mode === "update" &&
                    inlineSave.enabled &&
                    inlineSave.saveAsNew &&
                    trimmedName.length === 0)
                }
                busy={generating || saving}
                onClick={() => void handleGenerate()}
                label={mode === "update" ? "Update Sprite" : "Generate Sprite"}
              />

              {error && (
                <p className="mt-3 text-center text-xs text-rose-500">{error}</p>
              )}

              <ResultsPanel
                visible={hasResult}
                statusLabel={resultStatusLabel}
                symbolCount={symbolIds.length}
                spriteUrl={spriteUrl}
                spriteXml={spriteXml}
                symbolIds={symbolIds}
                onCopy={async () => {
                  const xmlToCopy = demoSpriteXml ?? spriteXml;
                  if (!xmlToCopy) {
                    showToast("Nothing to copy yet.", "warning");
                    return;
                  }
                  const ok = await copyToClipboard(xmlToCopy);
                  showToast(
                    ok ? "Copied to clipboard!" : "Failed to copy to clipboard",
                    ok ? "success" : "error"
                  );
                }}
                onDemo={() => {
                  setLiveDemoSource({ type: "results" });
                  setLiveDemoOpen(true);
                }}
                onAddIcons={handleAddIcons}
                addIconDisabled={!hasResult || generating}
                onDownloadZip={() => void handleDownloadBundleForResults()}
                downloadBusy={resultsDownloadBusy}
              />
            </main>
          </div>
        </main>
      </div>

      {/* Floating action button for the guide drawer. */}
      <button
        type="button"
        onClick={() => setGuideOpen(true)}
        className="group fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg bg-indigo-600 shadow-indigo-300/40 transition-all duration-200 hover:scale-110 active:scale-95 animate-pulse-ring"
        title="User Guide"
        aria-label="Open user guide"
      >
        <svg
          className="h-6 w-6 transition-transform group-hover:rotate-12"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      </button>

      <UserGuidePanel isOpen={guideOpen} onClose={() => setGuideOpen(false)} />

      <LiveDemoModal
        isOpen={liveDemoOpen}
        onClose={() => {
          // If a "Save Selected to Library" flow just set the demo buffer, keep it intact so `handleSaveToLibraryConfirm` can read the selected-only XML. The ref is set by `handleOpenSaveSelectedToLibrary` immediately before the LiveDemo fires `onClose?.()`; we read it, snapshot the value, then reset so the next plain close behaves as before.
          const preserve = preserveDemoStateOnCloseRef.current;
          preserveDemoStateOnCloseRef.current = false;
          setLiveDemoOpen(false);
          setLiveDemoMode("default");
          setLiveDemoIsBaseSpritePreview(false);
          if (!preserve) {
            setDemoSpriteXml(null);
            setDemoSymbolIds([]);
            setLiveDemoSource({ type: "scratch" });
            setDemoPreviewCssState(null);
            lastSeededSourceKeyRef.current = null;
          }
        }}
        sprite={demoSpriteXml ?? spriteXml}
        symbolIds={demoSpriteXml ? demoSymbolIds : symbolIds}
        source={liveDemoSource}
        mode={liveDemoMode}
        onUpdate={(next) => {
          setDemoSpriteXml(next.sprite);
          setDemoSymbolIds(next.symbolIds);
          if (
            liveDemoMode !== "preview" &&
            !liveDemoIsBaseSpritePreview &&
            liveDemoSource.type !== "results"
          ) {
            loadFromLibrary({ xml: next.sprite, symbolIds: next.symbolIds });
          }
        }}
       
        onSave={async ({ xml, symbolIds: saveIds }) => {
          // Library eye-icon preview: persist to the same library version.
          if (liveDemoSource.type === "library") {
            if (!liveDemoSource.isOwner) {
              showToast(
                "Only the owner can save changes to this library version.",
                "error"
              );
              return false;
            }
            if (!/^[a-f0-9]{24}$/i.test(liveDemoSource.id)) {
              showToast(
                "This preview isn't linked to a saved library version. Please reload the library from the side panel and try again.",
                "error"
              );
              return false;
            }
            try {
              if (saveIds.length === 0) {
                const { bundleName, remaining } = await deleteVersion(
                  liveDemoSource.id,
                );
                setDemoSpriteXml(null);
                setDemoSymbolIds([]);
                notifyLibraryChanged();
                if (remaining === 0) {
                  handleBundleDeleted(bundleName);
                }
                return "deleted" as const;
              }
              await updateContent(liveDemoSource.id, xml);
              setDemoSpriteXml(xml);
              setDemoSymbolIds(saveIds);
              notifyLibraryChanged();
              return true;
            } catch (err) {
              showToast(
                err instanceof Error
                  ? err.message
                  : "Failed to save changes.",
                "error",
              );
              return false;
            }
          }
          if (liveDemoSource.type === "baseSprite") {
            try {
              if (!baseSpriteFile) {
                showToast("Base sprite file is no longer available.", "error");
                return false;
              }
              const newFile = new File([xml], baseSpriteFile.name, {
                type: baseSpriteFile.type || "image/svg+xml",
              });
              setBaseSpriteFile(newFile);
              setDemoSpriteXml(xml);
              setDemoSymbolIds(saveIds);
              return true;
            } catch (err) {
              showToast(
                err instanceof Error
                  ? err.message
                  : "Failed to save changes.",
                "error",
              );
              return false;
            }
          }
          if (liveDemoSource.type === "results") {
            try {
              loadFromLibrary({ xml, symbolIds: saveIds });
              setDemoSpriteXml(xml);
              setDemoSymbolIds(saveIds);
              return true;
            } catch (err) {
              showToast(
                err instanceof Error
                  ? err.message
                  : "Failed to save changes.",
                "error",
              );
              return false;
            }
          }
          showToast("No preview source to save to.", "error");
          return false;
        }}
        onCopySprite={async () => {
          const xmlToCopy = demoSpriteXml ?? spriteXml;
          if (!xmlToCopy) return false;
          try {
            await copyToClipboard(xmlToCopy);
            return true;
          } catch {
            return false;
          }
        }}
        onCopyIcons={(icons: CopiedIcon[]) => {
          showToast(
            `Copied ${icons.length} icon${icons.length === 1 ? "" : "s"} to clipboard`,
            "success"
          );
        }}
        onCopySelectedRequest={(icons) => openPasteModal(icons)}
        onOpenSaveModal={() => onRequireAuth?.()}
        onGuestSaveChanges={handleGuestSaveChanges}
        onOpenSaveToLibrary={({ suggestedName }) =>
          openSaveToLibraryModal({ suggestedName })
        }
        onOpenSaveSelectedToLibrary={(icons) =>
          handleOpenSaveSelectedToLibrary(icons)
        }
        suggestedBundleName={activeBundleName || baseSpriteFile?.name.replace(/\.svg$/i, "")}
        onDownloadBundle={() => handleDownloadBundleForDemo()}
        bundleFileName={baseSpriteFile?.name}
        cssState={activeDemoCssState}
        onCssStateChange={setActiveDemoCssState}
      />

      <PasteIconsModal
        isOpen={!!pendingPasteIcons}
        icons={pendingPasteIcons ?? []}
        busy={pasteBusy}
        onClose={closePasteModal}
        currentBundleName={
          pasteExcludeBundleName ||
            (liveDemoSource.type === "library"
              ? liveDemoSource.name
              : activeBundleName || undefined)
        }
        // Surface which library/version/visibility the icons came from. Prefer the live demo's source (it has the full payload), fall back to a derived bundle+version when the user pasted from an "update mode" compile that wiped `liveDemoSource` but kept `pasteExcludeBundleName` + `baseSpriteVersion` set. As a final fallback, look up the bundle in `librarySprites` so we still show a real version + visibility when only the bundle name is available.
        sourceInfo={
          liveDemoSource.type === "library"
            ? {
                name: liveDemoSource.name,
                version: liveDemoSource.version,
                isPublic: !!liveDemoSource.isPublic,
                isOwner: liveDemoSource.isOwner,
              }
            : (() => {
                const name =
                  pasteExcludeBundleName || activeBundleName || undefined;
                if (!name) return undefined;
                // Look up the latest version in the library cache so we can show a real version number + visibility flag even when the demo was opened in scratch mode. The match is case-insensitive + trimmed so incidental differences between the source label and the server-side bundle name don't break the lookup.
                const lookupKey = name.trim().toLowerCase();
                const matches = librarySprites.filter(
                  (s) =>
                    (s.bundleName || s.name || "").trim().toLowerCase() ===
                    lookupKey,
                );
                const latest = matches.reduce<SpriteSummary | null>(
                  (acc, s) => (!acc || s.version > acc.version ? s : acc),
                  null,
                );
                return {
                  name,
                  version: baseSpriteVersion ?? latest?.version,
                  isPublic: latest?.isPublic,
                  isOwner: latest?.isOwner,
                };
              })()
        }
        onPasteIntoWorkspace={(icons) => {
          setPasteBusy(true);
          try {
            handlePasteIntoWorkspace(icons);
          } finally {
            setTimeout(() => setPasteBusy(false), 0);
          }
        }}
        onPasteIntoLibraryVersion={async (input) => {
          setPasteBusy(true);
          try {
            await handlePasteIntoLibraryVersion(input);
          } finally {
            setPasteBusy(false);
          }
        }}
      />

      <SaveToLibraryModal
        isOpen={saveModalOpen}
        busy={saveModalBusy}
        existingNames={existingLibraryNames}
        defaultName={saveModalName}
        placeholder={saveModalPlaceholder}
        nextVersion={saveModalNextVersion}
        initialIsPublic={saveModalIsPublic}
        onClose={() => {
          if (saveModalBusy) return;
          setSaveModalOpen(false);
          // If the save modal was opened from the "Save Selected" flow, the demo state still holds the selected-only XML/ids. Clear them here so a subsequent re-open of the LiveDemo falls back to the full main `spriteXml` / `symbolIds` instead of showing the stale subset. Reset the ref so the next normal save (no selection) doesn't trigger an unnecessary reset.
          if (saveModalOpenedFromSelectionRef.current) {
            saveModalOpenedFromSelectionRef.current = false;
            setDemoSpriteXml(null);
            setDemoSymbolIds([]);
          }
        }}
        onSubmit={handleSaveToLibraryConfirm}
      />
      <IconConflictModal
        isOpen={pendingConflicts !== null}
        conflicts={pendingConflicts ?? []}
        existingIds={pendingExistingContent ? existingSpriteIds : EMPTY_ID_SET}
        busy={conflictResolveBusy}
        onClose={handleCancelConflictModal}
        onApply={(resolutions) => void handleApplyConflictResolutions(resolutions)}/>
      <SelectFromLibraryModal
        isOpen={selectFromLibraryOpen}
        busy={selectFromLibraryBusy}
        onClose={closeSelectFromLibrary}
        onLoad={(summary) => void handleSelectFromLibraryLoad(summary)}
      />
    </div>
  );
}

export default Compiler;
