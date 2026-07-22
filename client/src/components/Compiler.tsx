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
import PasteIconsModal from "./compiler/PasteIconsModal";
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
      // Wrong-type SVG: the user dropped a sprite sheet into the
      // icon upload section. Use warning tone (matches the
      // duplicate-skip toast colour) and point them at the right
      // upload target.
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

  const { refetch: refetchLibrary, sprites: librarySprites, setVersionLabel, deleteVersion } = useLibrary(!!currentUser);

  // ── UI state ────────────────────────────────────────────────
  const [mode, setMode] = useState<CompilerMode>("new");
  const [baseSpriteFile, setBaseSpriteFile] = useState<File | null>(null);
  // Tracks where the currently-loaded base sprite came from.
  //   - "library"  : loaded from a saved library version (via the
  //     library panel's "Load to Update" or eye button). The
  //     inline-save panel shows the full two-toggle update-mode
  //     UI ("Save new version to library" + "Save as a new
  //     library instead") because the user already has a known
  //     bundle to attach a new version to.
  //   - "uploaded" : the user picked an `.svg` file from their
  //     computer in the update tab. The inline-save panel
  //     collapses to the simpler create-mode UI (single "Save
  //     to library" toggle with public/private) because there
  //     is no pre-existing bundle to version off of.
  //   - null       : no base sprite is loaded yet.
  const [baseSpriteSource, setBaseSpriteSource] = useState<
    "library" | "uploaded" | null
  >(null);
  // Version of the loaded base sprite, when it came from the
  // library. `null` means "unknown" (uploaded file or no file).
  // Surfaced in the ExistingSpriteSection so the user can see
  // which library version they're editing.
  const [baseSpriteVersion, setBaseSpriteVersion] = useState<
    number | null
  >(null);
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

  // "Paste Icons To..." modal. Lives at the Compiler level (not
  // inside the LiveDemo) so we can close the LiveDemo the moment
  // the paste popup opens — per UX request. The LiveDemo's
  // "Copy N Selected" footer button calls
  // `onCopySelectedRequest(icons)` to push the payload up here,
  // and we open the modal on top. When the user picks a target
  // the modal calls our `handlePasteIntoWorkspace` /
  // `handlePasteIntoLibraryVersion` (already defined below) and
  // auto-closes itself.
  const [pendingPasteIcons, setPendingPasteIcons] =
    useState<CopiedIcon[] | null>(null);
  const [pasteBusy, setPasteBusy] = useState<boolean>(false);

  // Open the paste modal at the Compiler level. Called from the
  // LiveDemo's "Copy N Selected" footer button via
  // `onCopySelectedRequest`. Closes the live demo so the user
  // lands on a clean canvas while they pick a paste target.
  function openPasteModal(icons: CopiedIcon[]): void {
    setPendingPasteIcons(icons);
    setLiveDemoOpen(false);
  }

  function closePasteModal(): void {
    if (pasteBusy) return;
    setPendingPasteIcons(null);
  }

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
  //
  // After the files land in the staging area we surface a
  // Preview / Undo toast. Undo pulls the same File objects back
  // out by reference (via `removeFiles`), so it works even if
  // the user has added or removed other files in the meantime.
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
    // Snapshot the just-pasted files so the Undo action can pull
    // them back out by reference later, even after the user adds
    // or removes other files in the staging area.
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
            // Generate a sprite from the just-pasted files and
            // open the live demo on it. The user lands on the
            // same "scratch" view the Results panel uses after a
            // fresh compile, but pre-loaded with the pasted
            // icons. The compiler's main `spriteXml` is left
            // untouched so the Results panel and the existing
            // library state aren't disturbed.
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

  // Paste icons into a specific library version. Loads the
  // version, merges the new symbols into it (new symbols win on
  // id collision), and saves as a new version. After the save
  // succeeds we surface a Preview / Undo toast so the user can
  // roll the paste back if it wasn't what they wanted.
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
    const saved = await saveSprite({
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
    // Capture the bundle/version info before the toast is
    // constructed; `saved` is the new sprite id+version. We
    // build a Preview / Undo toast so the user can roll the
    // paste back if it wasn't what they wanted. Undo deletes
    // the version we just created, leaving the bundle's older
    // versions intact.
    const pastedCount = input.icons.length;
    const newSpriteId = saved.id;
    const newVersion = saved.version;
    const bundleName = detail.bundleName;
    const previewXml = xml;
    const previewIds = merged.map((s) => s.id);
    showToast(
      `Pasted ${pastedCount} icon${pastedCount === 1 ? "" : "s"} into ${bundleName} v${newVersion}.`,
      "success",
      [
        {
          label: "Preview",
          type: "secondary",
          onClick: () => {
            // Open the live demo loaded with the just-pasted
            // version so the user can see exactly what they
            // committed. Seeded as a library source so the
            // modal's existing UI (Save to Library etc.) lines
            // up with what they see in the panel.
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
            // Force a re-seed of the preview buffer for this
            // (new) library id so the modal opens with the
            // right CSS.
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

  // Build a sprite from a specific list of staged files and
  // (optionally) open the live demo on the result. Used by the
  // "Preview" action on the workspace paste toast. We do NOT
  // push the pasted files into the dropzone first — instead we
  // build a sprite XML directly from the pasted payload (the
  // `CopiedIcon.content` is already a self-contained standalone
  // SVG) so the user can preview without disturbing the
  // existing staging list. The demo reads `demoSpriteXml` when
  // it's set, so seeding that with the previewed XML keeps the
  // compiler's `spriteXml` (and the Results panel) untouched.
  function generateFromFiles(
    inputFiles: File[],
    options: { openDemoOnDone: boolean }
  ): void {
    if (inputFiles.length === 0) return;
    // Read the staged files in parallel so we can assemble a
    // fresh sprite without round-tripping through the
    // compiler's `generate()` pipeline (which would overwrite
    // the existing `spriteXml`).
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
          // Pull every child of the <svg> into a single
          // <symbol> wrapper. We use the file name (sans
          // extension) as the symbol id, falling back to a
          // numeric suffix when two files share a name.
          const baseName =
            (svg.getAttribute("id") ||
              inputFiles[xmls.indexOf(xml)]?.name.replace(/\.svg$/i, "")) ??
            `icon-${symbols.length + 1}`;
          const inner = Array.from(svg.childNodes)
            .map((node) => (node as Element).outerHTML ?? "")
            .join("");
          // Skip duplicates by id so the preview sprite
          // mirrors the dedup behaviour of the actual
          // paste-into-workspace flow.
          if (symbols.some((s) => s.id === baseName)) continue;
          symbols.push({ id: baseName, viewBox, inner });
        }
        if (symbols.length === 0) return;
        const xml = buildSpriteXml(symbols);
        setDemoSpriteXml(xml);
        setDemoSymbolIds(symbols.map((s) => s.id));
        setLiveDemoSource({ type: "scratch" });
        // Force a re-seed of the preview buffer for scratch
        // mode so the modal opens with the right CSS.
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
    /**
     * Optional identifying info for the success toast. When
     * supplied, the toast tells the user which bundle + version
     * they just downloaded. Falls back to a generic message
     * when missing (e.g. an ad-hoc scratch compile).
     */
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
    // Surface the bundle + version in the success toast so the
    // user knows exactly what they just downloaded. Uses
    // template-literal interpolation so the declared
    // `bundleName` / `version` values are actually rendered
    // into the toast text.
    showToast(
      `Sprite bundle ${bundleName}(v${version}) downloaded successfully.`,
      "success",
    );
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
      // Prefer the live demo's source for a stable bundle +
      // version when the user is previewing a library version
      // (the Results panel may not have those values in scope).
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
  // Default toggle state per mode. The "Save to library" toggle
  // is OFF in both modes — a fresh compile has nothing to save
  // yet, and entering the Update tab starts the user in the
  // same "decide later" posture. The user is the only one who
  // can flip the toggle on; we never auto-enable it on tab
  // switch. Anything they did before is wiped on mode change.
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
      // Reset the preview buffer too so the new compile starts
      // from a clean custom-CSS slate, not a stale preview.
      setDemoPreviewCssState(null);
      lastSeededSourceKeyRef.current = null;
    } else if (next === "update" && mode !== "update") {
      // Entering the "Update Existing Sprite" tab. Reset the
      // inline-save state to its default so the toggle starts
      // OFF and the Library Name input starts empty. The user's
      // explicit choice in the previous tab does not carry
      // over — switching tabs is a navigation action, and the
      // "Save to library" intent is something the user should
      // re-confirm for the new mode.
    }
    // Always restore the toggle to its per-mode default when
    // switching tabs. This keeps the "Save to library" toggle
    // in the OFF position in both Create and Update modes,
    // and clears the Library Name field so the user starts
    // from a clean slate.
    setInlineSave(defaultInlineSave);
    setSaveStatus(null);
  }

  function clearExistingSprite() {
    setBaseSpriteFile(null);
    setBaseSpriteSource(null);
    setBaseSpriteVersion(null);
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
      // wiring. When the base sprite was loaded from the
      // library, tag the demo source as `library` so the modal
      // shows the bundle name + version chip in its title and
      // surfaces the right affordances. For uploaded files
      // (no saved bundle to attach to) we keep the scratch
      // source — there's no library context to surface.
      const demoXml = buildSpriteXml(symbols);
      setDemoSpriteXml(demoXml);
      setDemoSymbolIds(symbols.map((s) => s.id));
      if (baseSpriteSource === "library") {
        // Reuse the existing liveDemoSource if it's already a
        // library record (e.g. the user opened the demo for
        // the same bundle earlier and is now re-opening the
        // preview from the base-sprite section). Otherwise
        // synthesise a fresh library source from the active
        // bundle + version captured when the file was loaded.
        const existing =
          liveDemoSource.type === "library" ? liveDemoSource : null;
        setLiveDemoSource({
          type: "library",
          id: existing?.id ?? `preview-${activeBundleName}`,
          name: existing?.name ?? activeBundleName,
          version: existing?.version ?? baseSpriteVersion ?? 1,
          isOwner: existing?.isOwner ?? true,
          isPublic: existing?.isPublic ?? false,
        });
      } else {
        setLiveDemoSource({ type: "scratch" });
      }
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
      setBaseSpriteVersion(null);
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
        message: "Saved to library successfully!"
      });
      // Refresh the library list so the new version shows up
      // immediately in the side panel without the user having to
      // hit the refresh button. `refetchLibrary` only updates
      // this Compiler's `useLibrary` instance, so we also fire
      // the module-level "library changed" broadcast so the
      // LibraryPanel's separate `useLibrary` instance picks up
      // the new version too.
      void refetchLibrary();
      notifyLibraryChanged();
      // Stay in update mode so the user can keep iterating; the
      // next save will create v(n+1) of the same bundle.
      setActiveBundleName(saved.bundleName);
      // Reset the inline-save "Library Name" field so the next
      // save starts with an empty input. The `InlineSaveSection`
      // mirrors `value.name` into its local state via a
      // `useEffect`, so the visible input clears on the next
      // render too. For a new bundle we also reset `saveAsNew`
      // so the user isn't pinned to a stale "new library"
      // branch.
      setInlineSave((current) => ({
        ...current,
        name: "",
        saveAsNew: isNewBundle ? false : current.saveAsNew,
        hasNameConflict: false,
      }));
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
    // "Clear All" is scoped to the staged-files list only.
    // Everything else stays put: the user keeps the base
    // sprite file they uploaded/loaded, the active bundle
    // name, the live demo source, the preview buffer, the
    // inline-save fields, etc. We do NOT touch the
    // `inlineSave.enabled` toggle either — that's a user
    // choice and shouldn't be flipped by a clear button.
    clearFiles();
  };

  // ── Library → Update flow ──────────────────────────────────
  async function handleLoadFromLibrary(summary: SpriteSummary) {
    // Drop any in-flight "generated" state from a prior update so
    // the UI starts at the initial stage when the new library is
    // loaded: staged files list reappears, Generate button is
    // unlocked, and the result panel clears. Without this, a
    // post-update `hasGenerated === true` would keep the Generate
    // button locked and the staged list hidden until the user
    // re-uploads files. The library's own XML still gets surfaced
    // via `setBaseSpriteFile(file)` further down.
    clearFiles();
    resetForNewUpload();
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
      setBaseSpriteSource("library");
      setBaseSpriteVersion(detail.version);
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
      // The Library Name input stays empty so the user can see
      // the active bundle in the update section header but
      // still has to type a fresh name (or rely on the auto-
      // version flow) to commit a save. This matches the
      // default behaviour the user expects when entering
      // update mode.
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
      // Fall back to the previous (partial) behaviour: switch mode
      // and pre-fill the name so the user can still pick a file.
      setMode("update");
      setActiveBundleName(summary.bundleName || summary.name);
      setBaseSpriteSource("library");
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
      setInlineSave({
        enabled: summary.isOwner !== false,
        name: "",
        saveAsNew: false,
        hasNameConflict: false,
        isPublic: !!summary.isPublic,
      });
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
          onDownloadBundle={async (summary) => {
            // Library panel's "Download bundle" button: fetch the
            // full XML for the requested version, then build the
            // same zip the Results panel produces (sprite.svg +
            // demo.html + preview.png). The filename mirrors the
            // bundle name + version so a multi-version library
            // produces distinct downloads per row.
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
          onLibraryDeleted={({ name }) => {
            // If the deleted bundle is the one we have loaded, fall
            // back to scratch mode so the user can't accidentally
            // "save v(n+1)" to a library that no longer exists.
            if (activeBundleName && activeBundleName.toLowerCase() === name.toLowerCase()) {
              showToast(`The active library “${name}” was deleted.`, "warning");
              setBaseSpriteFile(null);
              setBaseSpriteVersion(null);
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
                  version={baseSpriteVersion}
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
                    setBaseSpriteVersion(null);
                    // Mark this base sprite as "uploaded" (not
                    // loaded from the library). The inline-save
                    // panel reads this to decide whether to show
                    // the two-toggle update-mode UI or the simpler
                    // single-toggle create-mode UI, because an
                    // uploaded file has no pre-existing bundle to
                    // version off of.
                    setBaseSpriteSource("uploaded");
                    setSaveStatus(null);
                    if (!activeBundleName) {
                      const fromName = f.name.replace(/\.svg$/i, "");
                      setActiveBundleName(fromName);
                    }
                    // Reset the inline-save toggle to OFF so the
                    // user starts in the create-mode default
                    // (toggle off) rather than the update-mode
                    // default (toggle on). An uploaded file has
                    // no pre-existing bundle to auto-version, so
                    // the "Save new version to library" default
                    // would be misleading.
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
                    // The user dropped a single icon into the
                    // existing-sprite section. Use error tone to
                    // match the existing "Base sprite must be an
                    // SVG file" message style and point the user
                    // at the icon upload target.
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
                // The two-toggle update-mode UI ("Save new version
                // to library" + "Save as a new library instead")
                // only makes sense when the base sprite was loaded
                // from the library — there has to be an existing
                // bundle to version off of. When the user uploaded
                // a file from their computer we collapse the panel
                // to the single-toggle create-mode UI instead.
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
                  // In Create mode the bundle name is the only
                  // thing that names a new library, so block the
                  // button when the user enabled "Save to library"
                  // without typing one. In Update mode the active
                  // bundle (from a loaded library) is used as the
                  // target by default, so an empty typed name is
                  // fine — unless the user has flipped the
                  // "Save as a new library instead" sub-toggle on,
                  // in which case the typed name becomes the new
                  // bundle's identifier and must be present.
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
        onCopySelectedRequest={(icons) => openPasteModal(icons)}
        onOpenSaveToLibrary={({ suggestedName }) =>
          openSaveToLibraryModal({ suggestedName })
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
        onPasteIntoWorkspace={(icons) => {
          setPasteBusy(true);
          try {
            handlePasteIntoWorkspace(icons);
          } finally {
            // Reset on the next tick so the close button is
            // disabled for the brief moment the modal is still
            // on-screen during its closing animation.
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
          if (!saveModalBusy) setSaveModalOpen(false);
        }}
        onSubmit={handleSaveToLibraryConfirm}
      />
    </div>
  );
}

export default Compiler;
