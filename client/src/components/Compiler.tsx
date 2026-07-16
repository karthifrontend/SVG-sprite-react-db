import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useFileDropzone } from "../hooks/useFileDropzone";
import { useSpriteCompiler } from "../hooks/useSpriteCompiler";
import { useLibrary, notifyLibraryChanged } from "../hooks/useLibrary";
import { getSpriteById, saveSprite, type SpriteSummary } from "../api/sprites";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { buildSpriteXml, extractSymbolsFromSprite } from "../utils/sprite";
import { copyToClipboard } from "../utils/formatters";
import CompilerHeader from "./compiler/CompilerHeader";
import ExistingSpriteSection from "./compiler/ExistingSpriteSection";
import FileDropzone from "./compiler/FileDropzone";
import GenerateButton from "./compiler/GenerateButton";
import InlineSaveSection, { type InlineSaveValue } from "./compiler/InlineSaveSection";
import LibraryPanel from "./compiler/LibraryPanel";
import LiveDemoModal, { type CopiedIcon, type LiveDemoCssState } from "./compiler/LiveDemo";
import type { Source as LiveDemoSource } from "./compiler/LiveDemo";
import SaveToLibraryModal from "./compiler/SaveToLibraryModal";
import { buildDemoHtml } from "../utils/sprite";
import { createZip, triggerBrowserDownload } from "../utils/zipBundle";
import { renderSpritePreviewPng } from "../utils/previewPng";
import ModeTabs, { type CompilerMode } from "./compiler/ModeTabs";
import ResultsPanel from "./compiler/ResultsPanel";
import StagedFilesList from "./compiler/StagedFilesList";
import UserGuidePanel from "./compiler/UserGuidePanel";

type CompilerProps = {
  onRequireAuth?: () => void;
  libraryOpen: boolean;
  onLibraryToggle: (next: boolean) => void;
};

/**
 * Compiler — page-level orchestrator. Owns mode/base-sprite state,
 * inline save state, and the guide drawer. The library panel
 * collapse state is owned by `App` so the Navbar's expand button
 * and the panel can stay in sync. All UI sections are composed
 * from `./compiler`.
 */
function Compiler({ onRequireAuth, libraryOpen, onLibraryToggle }: CompilerProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  // Wrap the dropzone so that adding new files after a sprite has
  // been generated returns the upload section to its initial stage
  // (clears the result, the hasGenerated flag, and the mode lock).
  // We also surface a warning toast whenever the user tries to stage
  // a file whose name+size is already in the list, so they know the
  // duplicate was intentionally skipped.
  const baseDropzone = useFileDropzone({
    onSkipped: (count) => {
      showToast(
        count === 1
          ? "1 duplicate skipped."
          : `${count} duplicates skipped.`,
        "warning"
      );
    },
  });
  const {
    files,
    clear: clearFiles,
    removeAt,
    onDragOver: baseOnDragOver,
    appendFiles,
    openPicker,
    inputRef,
  } = baseDropzone;

  // True once the user has generated a sprite in this session.
  // Drives the "hide staged list / sign-in hint" behaviour and the
  // tab-lock on the Generate button.
  const [hasGenerated, setHasGenerated] = useState(false);

  function resetForNewUpload() {
    // Drop the generated result so the UI looks like a fresh upload
    // (no sprite panel, staged list and sign-in hint reappear).
    // `resetSprite` already clears the sprite's error/symbols/url.
    resetSprite();
    setSaveStatus(null);
    setHasGenerated(false);
    // The tab and base sprite file stay as the user left them. We
    // intentionally do NOT force a tab switch on upload — the user
    // expects to remain on whichever tab they were working in.
    setActiveBundleName("");
    setLiveDemoSource({ type: "scratch" });
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
    // If a sprite was already generated, treat the new upload as a
    // fresh start: clear the staged batch and the generated result.
    // Otherwise just append the dropped files (original behaviour).
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
    copied,
    generate,
    copy,
    loadFromLibrary,
    waitForSprite,
    reset: resetSprite,
  } = useSpriteCompiler();

  const { refetch: refetchLibrary, sprites: librarySprites, setVersionLabel } = useLibrary(!!currentUser);

  // ── UI state ────────────────────────────────────────────────
  const [mode, setMode] = useState<CompilerMode>("new");
  const [baseSpriteFile, setBaseSpriteFile] = useState<File | null>(null);
  const [activeBundleName, setActiveBundleName] = useState<string>("");
  const [loadingFromLibrary, setLoadingFromLibrary] = useState(false);

  const [inlineSave, setInlineSave] = useState<InlineSaveValue>({
    enabled: false,
    name: "",
    saveAsNew: false,
    hasNameConflict: false,
    isPublic: false,
  });

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  // Live demo modal. Opened from the Results panel's "Live Demo"
  // button. When the modal mutates the sprite, it calls `onUpdate`
  // which we wire to the compiler's `loadFromLibrary` action so the
  // result panel reflects the changes immediately. The `source`
  // tells the modal whether the "Save Changes" CTA should appear
  // (only when the sprite came from a library version).
  const [liveDemoOpen, setLiveDemoOpen] = useState(false);
  const [liveDemoSource, setLiveDemoSource] = useState<LiveDemoSource>({ type: "scratch" });
  const [demoSpriteXml, setDemoSpriteXml] = useState<string | null>(null);
  const [demoSymbolIds, setDemoSymbolIds] = useState<string[]>([]);

  useEffect(() => {
    if (!spriteXml) return;
    setDemoSpriteXml(spriteXml);
    setDemoSymbolIds(symbolIds);
  }, [spriteXml, symbolIds]);

  // Custom-CSS state shared with the live demo. The state is held
  // in a single "preview" buffer that mirrors whatever the user
  // is currently looking at. The buffer is seeded:
  //   - from the saved library's CSS when the user opens that
  //     library's preview, or
  //   - from the default CSS when the user opens a fresh
  //     scratch compile.
  // While the user is tweaking the demo, only the preview buffer
  // is updated — the source library's stored CSS is never
  // touched. The new CSS is only persisted back to a library key
  // when the user explicitly clicks Save to Library, at which
  // point we copy the preview buffer to the newly-created
  // library's key. The previously-loaded library keeps its
  // original CSS untouched.
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
  // The preview buffer the live demo reads from / writes to.
  // `null` means "not seeded yet" — the consumer falls back to
  // `defaultCssState` until something populates it.
  const [demoPreviewCssState, setDemoPreviewCssState] =
    useState<LiveDemoCssState | null>(null);
  // Per-library CSS state, keyed by `library:<spriteId>`. The
  // live demo never writes here directly — only the save flow
  // does, when the user commits a new library to the server.
  const [libraryCssState, setLibraryCssState] = useState<
    Record<string, LiveDemoCssState>
  >({});
  // Tracks the source the preview buffer was last seeded from,
  // so re-opening the same library doesn't blow away the user's
  // in-progress tweaks. Compared by id+version so a saved update
  // to the same library (e.g. after refresh) re-seeds correctly.
  const lastSeededSourceKeyRef = useRef<string | null>(null);
  // What the live demo currently sees / mutates. Reads from
  // `demoPreviewCssState` (with a default fallback) so the
  // tweaks land in the scratch buffer, not in the source
  // library's record.
  const activeDemoCssState: LiveDemoCssState =
    demoPreviewCssState ?? defaultCssState;
  const setActiveDemoCssState = (next: LiveDemoCssState) => {
    setDemoPreviewCssState(next);
  };
  // Stable key for a source so we can compare it across renders
  // and dedupe seed calls.
  function sourceKey(source: LiveDemoSource): string {
    if (source.type === "library") {
      return `library:${source.id}:${source.version ?? 0}`;
    }
    return "scratch";
  }
  // Seed the preview buffer from a library's stored CSS (or
  // from defaults for a fresh scratch compile). Called by the
  // LibraryPanel's eye button, the Load-to-Update flow, and the
  // Results panel's Live Demo button. Re-seeds only when the
  // source actually changes — re-opening the same library
  // preserves the user's in-progress tweaks.
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

  // "Save to Library" modal (lives at the Compiler level so it can
  // talk to the live demo + the library list). Opens from the live
  // demo's "Save to Library" button.
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalName, setSaveModalName] = useState<string>("");
  // The placeholder shown inside the Library Name field when it's
  // empty. Computed at open time so the user always sees a
  // date-stamped default like "New sprite 7/15/2026". When the
  // user submits an empty field we fall back to this value so
  // the save still succeeds.
  const [saveModalPlaceholder, setSaveModalPlaceholder] = useState<string>("");
  const [saveModalNextVersion, setSaveModalNextVersion] = useState<number>(1);
  // Initial value of the modal's "Make it as public" toggle.
  // Seeded from the currently-loaded library's `isPublic` flag
  // when the modal opens, so saving a new version of an
  // existing bundle keeps the same visibility; falls back to
  // `false` (private) for new bundles.
  const [saveModalIsPublic, setSaveModalIsPublic] = useState<boolean>(false);
  const [saveModalBusy, setSaveModalBusy] = useState(false);

  // Returns the next version the server will assign for a given
  // bundle name. We scan the in-memory library list (sorted
  // newest-first by the panel) and add one. If the bundle doesn't
  // exist yet, this returns 1.
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
    // Per UX request, the modal always opens with an EMPTY Library
    // Name field. We compute a date-stamped default and pass it as
    // the input placeholder so the user sees a sensible hint
    // without us actually pre-filling the field. When the user
    // submits an empty value we fall back to the placeholder so
    // the save still succeeds.
    void input;
    const placeholder = "New sprite " + new Date().toLocaleDateString();
    setSaveModalName("");
    setSaveModalPlaceholder(placeholder);
    setSaveModalNextVersion(1);
    // Seed the public toggle from the currently-loaded library so
    // "save v4 of my public library" stays public by default.
    // For a fresh compile (no active bundle) it stays private.
    const activeSummary = activeBundleName
      ? librarySprites.find(
          (s) =>
            (s.bundleName || s.name || "").trim().toLowerCase() ===
            activeBundleName.trim().toLowerCase(),
        )
      : undefined;
    setSaveModalIsPublic(!!activeSummary?.isPublic);
    // Close the live demo so the user can interact with the
    // "Save to Organization" form on a clean canvas. The modal
    // remembers the sprite via `demoSpriteXml`/`demoSymbolIds`,
    // so re-opening will rehydrate it.
    setLiveDemoOpen(false);
    setSaveModalOpen(true);
  }

  async function handleSaveToLibraryConfirm(input: { name: string; version: string; isPublic: boolean }) {
    if (saveModalBusy) return;
    // The bundle name is exactly what the user typed, OR the
    // placeholder when the field was left empty. The version
    // description is a human label for this save (e.g. "v3" or
    // "Added 5 new icons") and is included as the per-sprite
    // `name`; the server still auto-increments the numeric
    // version under the same bundle, so each save appears as a
    // new row in the library panel.
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
        // Per-sprite label. The server overrides this with
        // "<bundle> v<N>", so we fall back to the bundle name when
        // the description is empty.
        name: input.version.trim() ? `${targetBundle} ${input.version.trim()}` : targetBundle,
        bundleName: targetBundle,
        xml,
        symbolIds: ids,
        symbolCount: ids.length,
        // Visibility is chosen in the modal — `true` makes the new
        // bundle / version visible to every signed-in user, `false`
        // keeps it private to the current owner.
        isPublic: input.isPublic,
      });
      setActiveBundleName(saved.bundleName);
      // Commit the in-progress preview buffer to the newly-saved
      // library's key. This is the ONLY place a library's stored
      // CSS is written — the live demo never mutates it directly,
      // so the previously-loaded library's CSS stays untouched.
      // When the user later re-opens the new library's preview,
      // `seedPreviewFromSource` copies this entry back into the
      // preview buffer.
      setLibraryCssState((prev) => ({
        ...prev,
        [`library:${saved.id}`]: activeDemoCssState,
      }));
      // Pin the user-typed version description onto the local
      // summary so the library panel shows "v4" (or whatever the
      // user typed) in the version pill, not the server's numeric
      // "v1". Must be set BEFORE refetchLibrary, because refetch
      // wipes the local list and the label cache re-applies it.
      const label = input.version.trim();
      if (label) {
        setVersionLabel(saved.id, label);
      }
      // Await the refetch so the library list shows the new
      // version immediately. Without this the user would have to
      // hit the refresh button to see the saved entry.
      await refetchLibrary();
      // Broadcast to every other `useLibrary` instance (e.g. the
      // LibraryPanel) so they also refetch and show the new entry
      // without the user clicking the refresh button.
      notifyLibraryChanged();
      // Recompute the next version so the modal, if reopened,
      // defaults to the new "v4" (or whatever).
      setSaveModalNextVersion(resolveNextVersionFor(saved.bundleName));
      showToast(
        `Saved "${saved.bundleName}" v${saved.version} to your library.`,
        "success"
      );
      setSaveModalOpen(false);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save sprite.",
        "error"
      );
    } finally {
      setSaveModalBusy(false);
    }
  }

  // Hand the current sprite (or the loaded one) back to the
  // compiler's staging area. We re-stage by writing the symbols as
  // individual File objects, then forcing a regen. This is the
  // simplest way to inject symbols without rewriting the file
  // dropzone API.
  //
  // Each copied icon already carries a full standalone `<svg>`
  // document (`CopiedIcon.content`) and its source symbol id
  // (`CopiedIcon.name`). We wrap the SVG text in a `File` so the
  // existing dropzone / staged-list code path renders it like any
  // other upload — the user can then either:
  //   1. Click "Generate" in the main page to compile a new
  //      sprite from the staged files, OR
  //   2. Already be in "update" mode against a library, in which
  //      case the next Generate merges the pasted icons into a
  //      new version of that library.
  function handlePasteIntoWorkspace(icons: CopiedIcon[]) {
    if (!icons || icons.length === 0) return;
    // De-duplicate by name against the currently-staged files so
    // the user doesn't end up with two rows for the same icon if
    // they paste the same selection twice. We compare by basename
    // (since every File the dropzone stores has its own name) and
    // by the source symbol id, so a paste that targets the same
    // icon from a different selection set is treated as a refresh,
    // not a duplicate.
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
    showToast(
      `Pasted ${newFiles.length} icon${newFiles.length === 1 ? "" : "s"} into the workspace.`,
      "success",
    );
  }

  // Paste icons into a specific library version. Loads the
  // version, merges the new symbols into it (new symbols win on
  // id collision), and saves as a new version.
  async function handlePasteIntoLibraryVersion(input: {
    spriteId: string;
    bundleName: string;
    version: number;
    icons: CopiedIcon[];
  }) {
    const detail = await getSpriteById(input.spriteId);
    const baseSymbols = extractSymbolsFromSprite(detail.xml);
    const newSymbols = input.icons.map((icon) => {
      // Re-parse the raw symbol so we get the same SpriteSymbol
      // shape the compiler uses.
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
    const xml = buildSpriteXml(merged);
    await saveSprite({
      name: detail.bundleName,
      bundleName: detail.bundleName,
      xml,
      symbolIds: merged.map((s) => s.id),
      symbolCount: merged.length,
      isPublic: detail.isPublic,
    });
    await refetchLibrary();
    // Broadcast to every other `useLibrary` instance so the
    // LibraryPanel shows the new pasted-into-library version
    // without a manual refresh.
    notifyLibraryChanged();
  }

  // Build + download an SVG sprite bundle (sprite + demo.html +
  // preview.png) wrapped in a zip. Used by the Results panel's
  // "Download zip" button and by the live demo's logged-out
  // "Save" button — both call the same builder so the bundle
  // contents are identical regardless of the entry point.
  const [resultsDownloadBusy, setResultsDownloadBusy] = useState(false);
  async function buildAndDownloadBundle(input: {
    xml: string;
    ids: string[];
    fileName: string;
  }): Promise<boolean> {
    const { xml, ids, fileName } = input;
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
    showToast("Sprite bundle downloaded.", "success");
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
      await buildAndDownloadBundle({
        xml,
        ids: symbolIds,
        fileName: (baseSpriteFile?.name || "sprite").replace(/\.svg$/i, ""),
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
  // Logged-out "Save" inside the live demo modal — uses the
  // shared builder with the demo's currently-previewed XML (or
  // the freshly-generated sprite if no preview is open).
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
      // Pre-fill the name with the active bundle (when loaded from
      // the library) or with a sensible default. Mark conflict if
      // the name matches a different bundle.
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
        // If we're in update mode AND the candidate matches the
        // active bundle, the natural flow is "save as new version",
        // not "save as new library".
        saveAsNew: current.saveAsNew && !isActiveBundle,
        hasNameConflict: existingLibraryNames.includes(candidateKey) && !isActiveBundle,
        // Preserve the existing visibility choice when re-enabling
        // the toggle so users don't accidentally flip a bundle
        // between public and private mid-flow.
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
  function changeMode(next: CompilerMode) {
    setMode(next);
    if (next === "new") {
      setBaseSpriteFile(null);
      setActiveBundleName("");
      setLiveDemoSource({ type: "scratch" });
      // Reset the preview buffer too so the new compile starts
      // from a clean custom-CSS slate, not a stale preview.
      setDemoPreviewCssState(null);
      lastSeededSourceKeyRef.current = null;
      // Create New Sprite mode always shows the "Save to
      // library" toggle in its default (OFF) state. If the user
      // had it ON from a prior session in update mode (or it
      // was forced ON by some other flow), reset it here so
      // the toggle doesn't appear pre-enabled without the
      // user having clicked it. The other inline-save fields
      // are preserved so re-toggling ON is frictionless.
      setInlineSave((current) => ({
        ...current,
        enabled: false,
        saveAsNew: false,
        hasNameConflict: false,
      }));
    } else if (next === "update" && mode !== "update") {
      // Entering the "Update Existing Sprite" tab from "Create
      // New Sprite" — for signed-in users, default the master
      // "Save new version to library" toggle to ON with the
      // "Save as a new library instead" sub-toggle OFF, so the
      // user starts in the most common flow (save a new
      // version of the bundle they're about to load). For
      // logged-out users we keep the toggle OFF so the
      // "Update Sprite" button compiles the sprite in-browser
      // without opening the login modal. We only seed on the
      // tab transition itself, not on every render, so a user
      // who explicitly flips the toggle on/off while in update
      // mode keeps that choice until they re-enter the tab.
      if (currentUser) {
        setInlineSave((current) =>
          current.enabled
            ? current
            : {
                ...current,
                enabled: true,
                saveAsNew: false,
                hasNameConflict: false,
              },
        );
      } else {
        setInlineSave((current) => ({
          ...current,
          enabled: false,
          saveAsNew: false,
          hasNameConflict: false,
        }));
      }
    }
    setSaveStatus(null);
  }

  function clearExistingSprite() {
    setBaseSpriteFile(null);
    setActiveBundleName("");
    setLiveDemoSource({ type: "scratch" });
    setDemoPreviewCssState(null);
    lastSeededSourceKeyRef.current = null;
    setInlineSave((current) => ({
      ...current,
      enabled: false,
      name: "",
      saveAsNew: false,
      hasNameConflict: false,
      isPublic: false,
    }));
  }

  // Open the Live Demo modal pre-populated with the symbols from
  // the currently-loaded base sprite file. The user can rename /
  // delete icons inside the modal just like with a freshly-
  // generated sprite, but the preview source is a "scratch"
  // because the base sprite file has not been saved to a library
  // yet. Existing functionality, data, and DB code are untouched.
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
      // Reuse the demo preview buffer used by the Results panel
      // so the existing LiveDemoModal renders without any extra
      // wiring. Treat the base sprite as a scratch source so
      // "Save Changes" doesn't appear in the modal (we are not
      // previewing a library version).
      const demoXml = buildSpriteXml(symbols);
      setDemoSpriteXml(demoXml);
      setDemoSymbolIds(symbols.map((s) => s.id));
      setLiveDemoSource({ type: "scratch" });
      // Re-seed the custom-CSS preview buffer from defaults so
      // the modal opens with a clean slate, mirroring how the
      // Results panel's "Live Demo" button behaves after a
      // fresh compile.
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

  // ── Generate ───────────────────────────────────────────────
  async function handleGenerate() {
    setSaveStatus(null);
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

    await generate(files, existingContent ? { existingContent } : undefined);

    // Lock the Generate button until new files are uploaded.
    setHasGenerated(true);

    // Drop the base sprite file (its contents have been consumed by
    // the generator). This also visually clears the Base Sprite
    // File section, so the user knows to re-upload one before the
    // next generation.
    if (mode === "update") {
      setBaseSpriteFile(null);
      setActiveBundleName("");
      setLiveDemoSource({ type: "scratch" });
      setInlineSave({
        enabled: false,
        name: "",
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: false,
      });
    }

    if (!inlineSave.enabled) {
      showToast(
        mode === "update"
          ? "Sprite updated in your browser!"
          : "Sprite generated instantly in your browser!",
        "success"
      );
      return;
    }

    const { xml, symbolIds: ids } = await waitForSprite();
    if (!xml) return;

    // Decide the target bundle name:
    //   - "save as new" off + active bundle set -> new version of the
    //     active bundle (server increments version).
    //   - "save as new" on OR no active bundle -> brand-new bundle
    //     using the typed name.
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
      setSaveStatus({
        kind: "ok",
        message: isNewBundle
          ? `Saved "${saved.bundleName}" v${saved.version} to library (${saved.symbolCount} symbol${saved.symbolCount === 1 ? "" : "s"}).`
          : `Saved "${saved.bundleName}" as v${saved.version} (${saved.symbolCount} symbol${saved.symbolCount === 1 ? "" : "s"}).`,
      });
      void refetchLibrary();
      // Stay in update mode so the user can keep iterating; the
      // next save will create v(n+1) of the same bundle.
      setActiveBundleName(saved.bundleName);
      if (isNewBundle) {
        setInlineSave((current) => ({ ...current, saveAsNew: false }));
      }
    } catch (err) {
      setSaveStatus({
        kind: "err",
        message: err instanceof Error ? err.message : "Failed to save sprite.",
      });
    } finally {
      setSaving(false);
    }
  }

  const handleClearAll = () => {
    clearFiles();
    setBaseSpriteFile(null);
    setActiveBundleName("");
    setLiveDemoSource({ type: "scratch" });
    setDemoPreviewCssState(null);
    lastSeededSourceKeyRef.current = null;
    // The default "Save to library" behaviour differs by mode:
    //   - Create New Sprite: always default the toggle to OFF
    //     when staged files are cleared, so the toggle never
    //     appears pre-enabled without the user having clicked
    //     it. The other inline-save fields (name, isPublic)
    //     are also cleared.
    //   - Update Existing Sprite: keep the master "Save new
    //     version to library" toggle on (its default in update
    //     mode) so the user retains the same save intent after
    //     clearing the staged files. The sub-toggle stays off so
    //     the user remains in the "new version" branch, and the
    //     typed name + public flag are cleared because they
    //     referred to the now-removed staged files.
    if (mode === "new") {
      setInlineSave((current) => ({
        ...current,
        enabled: false,
        saveAsNew: false,
        name: "",
        hasNameConflict: false,
        isPublic: false,
      }));
    } else {
      setInlineSave((current) => ({
        ...current,
        enabled: true,
        saveAsNew: false,
        name: "",
        hasNameConflict: false,
        isPublic: false,
      }));
    }
    setSaveStatus(null);
  };

  // ── Library → Update flow ──────────────────────────────────
  async function handleLoadFromLibrary(summary: SpriteSummary) {
    setMode("update");
    setLoadingFromLibrary(true);
    setSaveStatus(null);
    try {
      const detail = await getSpriteById(summary._id);
      const bundleName = detail.bundleName || detail.name;
      const isOwner = detail.isOwner !== false; // server defaults to true on writes

      // Build a synthetic File from the loaded XML so the existing
      // sprite section can display the base file (and the compiler
      // can read its text as `existingContent`).
      const blob = new Blob([detail.xml], { type: "image/svg+xml" });
      const file = new File([blob], `${bundleName}.svg`, { type: "image/svg+xml" });
      setBaseSpriteFile(file);
      setActiveBundleName(bundleName);

      // The live-demo modal can persist edits directly to this
      // library version via `useLibrary().updateContent`.
      const newSource: LiveDemoSource = {
        type: "library",
        id: detail.id,
        name: bundleName,
        version: detail.version,
        isOwner,
        isPublic: !!detail.isPublic,
      };
      setLiveDemoSource(newSource);
      // Pre-seed the preview buffer with the loaded library's
      // CSS so any subsequent demo open starts from that
      // library's stored customisation rather than from a stale
      // preview left over from a prior session.
      seedPreviewFromSource(newSource);

      // Only pre-enable the save toggle for the owner of the
      // bundle. Public bundles loaded by non-owners stay
      // read-only on this screen (they can still open the live
      // demo, copy the XML, or load it to a new bundle).
      setInlineSave({
        enabled: isOwner,
        name: bundleName,
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: !!detail.isPublic,
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to load sprite from library.",
        "error"
      );
      // Fall back to the previous (partial) behaviour: switch mode
      // and pre-fill the name so the user can still pick a file.
      setMode("update");
      setActiveBundleName(summary.bundleName || summary.name);
      const fallbackSource: LiveDemoSource = {
        type: "library",
        id: summary._id,
        name: summary.bundleName || summary.name,
        version: summary.version,
        isOwner: summary.isOwner !== false,
        isPublic: !!summary.isPublic,
      };
      setLiveDemoSource(fallbackSource);
      seedPreviewFromSource(fallbackSource);
      setInlineSave((current) => ({
        ...current,
        enabled: summary.isOwner !== false,
        name: summary.bundleName || summary.name,
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: !!summary.isPublic,
      }));
    } finally {
      setLoadingFromLibrary(false);
    }
  }

  function handleSelectFromLibrary() {
    if (!currentUser) {
      onRequireAuth?.();
      return;
    }
    onLibraryToggle(true);
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
            // Seed the preview buffer from the library's stored
            // CSS (or defaults for scratch) so the user sees that
            // library's saved customisation. Tweak the preview
            // buffer will NOT modify the source library's record.
            seedPreviewFromSource(source);
            setLiveDemoOpen(true);
          }}
          onLibraryRenamed={({ oldName, newName }) => {
            // If the user renamed the bundle currently loaded into
            // the compiler, update the local references so the next
            // save targets the new MongoDB name.
            if (activeBundleName && activeBundleName.toLowerCase() === oldName.toLowerCase()) {
              setActiveBundleName(newName);
              if (liveDemoSource.type === "library") {
                setLiveDemoSource({ ...liveDemoSource, name: newName });
              }
              setInlineSave((current) =>
                current.name.trim().toLowerCase() === oldName.toLowerCase()
                  ? { ...current, name: newName }
                  : current
              );
            }
          }}
          onLibraryDeleted={({ name }) => {
            // If the deleted bundle is the one we have loaded, fall
            // back to scratch mode so the user can't accidentally
            // "save v(n+1)" to a library that no longer exists.
            if (activeBundleName && activeBundleName.toLowerCase() === name.toLowerCase()) {
              showToast(`The active library “${name}” was deleted.`, "warning");
              setBaseSpriteFile(null);
              setActiveBundleName("");
              setLiveDemoSource({ type: "scratch" });
              setDemoPreviewCssState(null);
              lastSeededSourceKeyRef.current = null;
              setInlineSave((current) => ({
                ...current,
                enabled: false,
                name: "",
                saveAsNew: false,
                hasNameConflict: false,
                isPublic: false,
              }));
            }
            // Purge any cached CSS for the deleted library so a
            // future save under the same name starts fresh.
            setLibraryCssState((prev) => {
              const next: Record<string, LiveDemoCssState> = {};
              for (const [key, value] of Object.entries(prev)) {
                // We don't have the deleted id here, but the
                // refetch from useLibrary will trim the sprites
                // array. The label cache is the same shape and
                // is purged by useLibrary itself.
                if (key !== `library:${name}`) next[key] = value;
              }
              return next;
            });
          }}
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
                  onFile={(f) => {
                    if (f === null) {
                      showToast("Base sprite must be an SVG file.", "error");
                      return;
                    }
                    // Picking a new base sprite (after a generation)
                    // should drop the previously generated sprite and
                    // return the UI to the initial stage so the user
                    // can generate again from scratch.
                    if (hasGenerated) {
                      resetForNewUpload();
                      clearFiles();
                    }
                    setBaseSpriteFile(f);
                    setSaveStatus(null);
                    if (!activeBundleName) {
                      const fromName = f.name.replace(/\.svg$/i, "");
                      setActiveBundleName(fromName);
                      setInlineSave((current) => ({
                        ...current,
                        enabled: current.enabled,
                        name: current.enabled ? current.name || fromName : current.name,
                      }));
                    }
                  }}
                  onClear={clearExistingSprite}
                  onSelectFromLibrary={handleSelectFromLibrary}
                  canSelectFromLibrary={!!currentUser}
                  onPreview={handlePreviewBaseSprite}
                />
              )}

              {mode === "update" && (
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    2. New Icons to Add
                  </h2>
                  {loadingFromLibrary && (
                    <span className="text-[10px] font-mono text-indigo-500">
                      Loading…
                    </span>
                  )}
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
                  (mode === "update" && !baseSpriteFile)
                }
                busy={generating || saving}
                onClick={() => void handleGenerate()}
                label={mode === "update" ? "Update Sprite" : "Generate Sprite"}
              />

              {error && (
                <p className="mt-3 text-center text-xs text-rose-500">{error}</p>
              )}

              {saveStatus && (
                <p
                  className={
                    "mt-3 text-center text-xs " +
                    (saveStatus.kind === "ok" ? "text-emerald-600" : "text-rose-500")
                  }
                >
                  {saveStatus.message}
                </p>
              )}

              <ResultsPanel
                visible={hasResult}
                symbolCount={symbolIds.length}
                spriteUrl={spriteUrl}
                spriteXml={spriteXml}
                symbolIds={symbolIds}
                copied={copied}
                onCopy={() => void copy()}
                onDemo={() => setLiveDemoOpen(true)}
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
        className="group fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-300/40 transition-all duration-200 hover:scale-110 active:scale-95 animate-pulse-ring"
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
        onClose={() => setLiveDemoOpen(false)}
        sprite={demoSpriteXml ?? spriteXml}
        symbolIds={demoSpriteXml ? demoSymbolIds : symbolIds}
        source={liveDemoSource}
        onUpdate={(next) => {
          // Re-hydrate the compiler's output with the mutated XML
          // so the result panel (download URL, code preview) stays
          // in sync with what the modal shows.
          loadFromLibrary({ xml: next.sprite, symbolIds: next.symbolIds });
          setDemoSpriteXml(next.sprite);
          setDemoSymbolIds(next.symbolIds);
        }}
        onCopySprite={async () => {
          // The Live Demo shows `demoSpriteXml` (which reflects any
          // rename / remove actions the user performed inside the
          // modal) and only falls back to the compiler's
          // freshly-generated `spriteXml` when no demo preview has
          // been opened. Copy whichever the user is actually
          // looking at — the compiler's `copy()` helper reads
          // `spriteXml` only, so it can be null (nothing generated
          // yet, only a demo loaded from the library) or stale
          // (demo was mutated after the original compile).
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
        onOpenSaveToLibrary={({ suggestedName }) =>
          openSaveToLibraryModal({ suggestedName })
        }
        onPasteIntoWorkspace={handlePasteIntoWorkspace}
        onPasteIntoLibraryVersion={handlePasteIntoLibraryVersion}
        suggestedBundleName={activeBundleName || baseSpriteFile?.name.replace(/\.svg$/i, "")}
        onDownloadBundle={() => handleDownloadBundleForDemo()}
        bundleFileName={baseSpriteFile?.name}
        cssState={activeDemoCssState}
        onCssStateChange={setActiveDemoCssState}
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
          if (!saveModalBusy) setSaveModalOpen(false);
        }}
        onSubmit={handleSaveToLibraryConfirm}
      />
    </div>
  );
}

export default Compiler;
