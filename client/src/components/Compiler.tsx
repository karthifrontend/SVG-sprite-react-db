import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { useFileDropzone } from "../hooks/useFileDropzone";
import { useSpriteCompiler } from "../hooks/useSpriteCompiler";
import { useLibrary } from "../hooks/useLibrary";
import { getSpriteById, saveSprite, type SpriteSummary } from "../api/sprites";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import CompilerHeader from "./compiler/CompilerHeader";
import ExistingSpriteSection from "./compiler/ExistingSpriteSection";
import FileDropzone from "./compiler/FileDropzone";
import GenerateButton from "./compiler/GenerateButton";
import InlineSaveSection, { type InlineSaveValue } from "./compiler/InlineSaveSection";
import LibraryPanel from "./compiler/LibraryPanel";
import LiveDemoModal, { type CopiedIcon } from "./compiler/LiveDemo";
import type { Source as LiveDemoSource } from "./compiler/LiveDemo";
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

  const { refetch: refetchLibrary, sprites: librarySprites } = useLibrary(!!currentUser);

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

  // User guide drawer.
  const [guideOpen, setGuideOpen] = useState(false);

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
  const canSave = inlineSave.enabled && trimmedName.length > 0 && !inlineSave.hasNameConflict;
  const canGenerate =
    !generating &&
    !saving &&
    (hasFiles || (mode === "update" && !!baseSpriteFile)) &&
    (mode !== "update" || !!baseSpriteFile) &&
    (!inlineSave.enabled || canSave);

  // ── Mode switcher side-effects ─────────────────────────────
  function changeMode(next: CompilerMode) {
    setMode(next);
    if (next === "new") {
      setBaseSpriteFile(null);
      setActiveBundleName("");
      setLiveDemoSource({ type: "scratch" });
    }
    setSaveStatus(null);
  }

  function clearExistingSprite() {
    setBaseSpriteFile(null);
    setActiveBundleName("");
    setLiveDemoSource({ type: "scratch" });
    setInlineSave((current) => ({
      ...current,
      enabled: false,
      name: "",
      saveAsNew: false,
      hasNameConflict: false,
      isPublic: false,
    }));
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
    setInlineSave({
      enabled: false,
      name: "",
      saveAsNew: false,
      hasNameConflict: false,
      isPublic: false,
    });
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
      setLiveDemoSource({
        type: "library",
        id: detail.id,
        name: bundleName,
        version: detail.version,
        isOwner,
        isPublic: !!detail.isPublic,
      });

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
      setLiveDemoSource({
        type: "library",
        id: summary._id,
        name: summary.bundleName || summary.name,
        version: summary.version,
        isOwner: summary.isOwner !== false,
        isPublic: !!summary.isPublic,
      });
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
        <LibraryPanel
          isOpen={libraryOpen}
          onCollapseToggle={() => onLibraryToggle(false)}
          onOpenLogin={() => onRequireAuth?.()}
          onLoadToUpdate={handleLoadFromLibrary}
          onOpenDemo={({ sprite, symbolIds, source }) => {
            setDemoSpriteXml(sprite);
            setDemoSymbolIds(symbolIds);
            setLiveDemoSource(source);
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
              setInlineSave((current) => ({
                ...current,
                enabled: false,
                name: "",
                saveAsNew: false,
                hasNameConflict: false,
                isPublic: false,
              }));
            }
          }}
        />

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
                  canSelectFromLibrary
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
              {!currentUser && !hasGenerated && (
                <p className="-mt-3 mb-5 text-center text-[11px] text-slate-500">
                  Sign in to save sprites to your library. Generating still works without an account.
                </p>
              )}

              <GenerateButton
                disabled={!canGenerate || hasGenerated}
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
          try {
            await copy();
            return true;
          } catch {
            return false;
          }
        }}
        onCopyIcons={(icons: CopiedIcon[]) => {
          // For now just toast — a future "paste into this sprite"
          // flow can consume this payload.
          showToast(
            `Copied ${icons.length} icon${icons.length === 1 ? "" : "s"} to clipboard`,
            "success"
          );
        }}
      />
    </div>
  );
}

export default Compiler;
