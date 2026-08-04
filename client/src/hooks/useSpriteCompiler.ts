// useSpriteCompiler. Owns the compile state machine: queue icons, merge/update, build sprite XML, and emit demo HTML.
import { useCallback, useEffect, useRef, useState } from "react";
import { buildDemoHtml, buildSpriteXml, extractSymbolsFromSprite, sortSymbolsById, svgFileToSymbol, type SpriteSymbol } from "../utils/sprite";

type CompilerState = {
  generating: boolean;
  spriteUrl: string | null;
  spriteXml: string | null;
  symbolIds: string[];
  error: string | null;
  copied: boolean;
};

type CompilerActions = {
  // Run the sprite-generation pipeline on the supplied files. Returns a summary describing what was actually merged into the output sprite. In update mode (`existingContent` provided) the summary reports how many of the staged files produced duplicate symbol ids against the base sprite, so the caller can surface a "skipped N duplicates" toast. When every staged file is a duplicate the hook skips the generation entirely and returns `allDuplicates: true` with no sprite state changes — the caller should treat that as a no-op and bail before any save flow runs. When the staged files contain ONE OR MORE id collisions against the base sprite, the hook returns `needsConfirmation: true` with a `conflicts` list so the caller can open a Windows-Explorer-style "Replace or Skip Files" modal and let the user pick per-icon; the sprite state is unchanged in that case so the user can resume without losing their place.
  generate: (
    files: File[],
    options?: { existingContent?: string }
  ) => Promise<GenerateSummary>;
  // Apply a per-conflict resolution produced by the conflict UI and produce the final merged sprite. The caller is expected to call this AFTER the user has resolved every conflict in the modal (the modal itself guarantees all rows are answered). The hook does the actual merge / blob / state update + returns a `GenerateSummary` so the existing save-flow path can be reused unchanged. The `resolutions` map is keyed by the conflicting symbol id.
  applyConflictResolutions: (
    files: File[],
    options: { existingContent?: string },
    resolutions: Record<string, ConflictResolution>
  ) => Promise<GenerateSummary>;
  copy: () => Promise<void>;
  openDemo: () => void;
  reset: () => void;
  waitForSprite: () => Promise<{ xml: string; symbolIds: string[] }>;
  loadFromLibrary: (input: { xml: string; symbolIds: string[] }) => void;
};

export type IconConflict = {
  id: string;
  existing: SpriteSymbol;
  incoming: SpriteSymbol;
};

export type ConflictResolution =
  | { kind: "replace" }
  | { kind: "skip" }
  | { kind: "both"; renamedId: string };

// Outcome of a `generate()` call. `duplicateCount` is the number of staged files whose symbol id was already present in the base sprite (only meaningful in update mode). `newCount` is the number of staged files that contributed a fresh symbol to the merged output. `allDuplicates` is the short-circuit signal: when true, the hook skipped the generation entirely and the caller should treat the call as a no-op. `needsConfirmation` is the conflict-modal signal: when true, the hook found one or more id collisions against the base sprite and PAUSED without producing a sprite; the caller should open the conflict modal and call `applyConflictResolutions` once the user has picked an action for every conflict.
export type GenerateSummary = {
  duplicateCount: number;
  newCount: number;
  allDuplicates: boolean;
  needsConfirmation?: boolean;
  conflicts?: IconConflict[];
};

const COPY_FEEDBACK_MS = 1500;

// Drives the sprite-generation pipeline: turn staged files into a sprite document, build a blob URL for download, and expose copy/demo actions.
export function useSpriteCompiler(): CompilerState & CompilerActions {
  const [generating, setGenerating] = useState(false);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [spriteXml, setSpriteXml] = useState<string | null>(null);
  const [symbolIds, setSymbolIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Keep a ref to the latest blob URL so we can revoke it on unmount/replace.
  const urlRef = useRef<string | null>(null);
  // Mirror of spriteXml/symbolIds so consumers outside the render cycle (e.g. async save flows) can read the freshest values.
  const xmlRef = useRef<string | null>(null);
  const symbolIdsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const replaceUrl = useCallback((next: string | null) => {
    if (urlRef.current && urlRef.current !== next) {
      URL.revokeObjectURL(urlRef.current);
    }
    urlRef.current = next;
    setSpriteUrl(next);
  }, []);

  const generate = useCallback(
    async (
      files: File[],
      options?: { existingContent?: string }
    ): Promise<GenerateSummary> => {
      if (files.length === 0 && !options?.existingContent) {
        return { duplicateCount: 0, newCount: 0, allDuplicates: false };
      }
      setGenerating(true);
      setError(null);
      try {
        const newSymbols = await Promise.all(files.map(svgFileToSymbol));

        // In update mode, pull the existing symbols out of the base sprite and merge them with the new ones. New symbols win when ids collide.
        const existingSymbols = options?.existingContent
          ? extractSymbolsFromSprite(options.existingContent)
          : [];
        // Pre-compute the duplicate set against the base sprite so we can return a summary the caller uses for its toast copy and to surface the conflict modal. We compare by symbol id (derived from the staged file's name) — the same id the server-side library merge uses, so a file dropped here that collides with an existing library symbol is treated as a duplicate here too.
        const existingIds = new Set(existingSymbols.map((s) => s.id));
        const existingById = new Map(existingSymbols.map((s) => [s.id, s]));
        const duplicateCount = newSymbols.filter((s) => existingIds.has(s.id)).length;
        const trulyNewSymbols = newSymbols.filter((s) => !existingIds.has(s.id));

        if (existingSymbols.length > 0 && duplicateCount > 0) {
          const conflicts: IconConflict[] = newSymbols
            .filter((s) => existingIds.has(s.id))
            .map((s) => {
              const existing = existingById.get(s.id);
              if (!existing) {
                return { id: s.id, existing: s, incoming: s };
              }
              return { id: s.id, existing, incoming: s };
            });
          // Preserve any sprite that was already generated so the Results panel stays intact when the user dismisses the conflict modal without resolving (Cancel, X, or backdrop). The state-reset + state-write below only runs in the success path, so a `needsConfirmation: true` return leaves the previous `spriteXml` / `symbolIds` / `spriteUrl` untouched.
          return {
            duplicateCount,
            newCount: 0,
            allDuplicates: false,
            needsConfirmation: true,
            conflicts,
          };
        }
        // We are about to overwrite any existing sprite — wipe the previous state only at this point, so the conflict-modal cancel path keeps the previously generated sprite visible.
        setSpriteXml(null);
        setSymbolIds([]);
        xmlRef.current = null;
        symbolIdsRef.current = [];
        replaceUrl(null);
        const seen = new Set<string>();
        const merged: SpriteSymbol[] = [];
        for (const s of [...existingSymbols, ...trulyNewSymbols]) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          merged.push(s);
        }

        const sortedMerged = sortSymbolsById(merged);

        const xml = buildSpriteXml(sortedMerged);
        const blob = new Blob([xml], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        replaceUrl(url);
        setSpriteXml(xml);
        setSymbolIds(sortedMerged.map(s => s.id));
        xmlRef.current = xml;
        symbolIdsRef.current = sortedMerged.map(s => s.id);
        return { duplicateCount, newCount: trulyNewSymbols.length, allDuplicates: false };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate sprite.");
        return { duplicateCount: 0, newCount: 0, allDuplicates: false };
      } finally {
        setGenerating(false);
      }
    },
    [replaceUrl]
  );

  // Apply the user's per-conflict resolutions and produce the final merged sprite. 
  const applyConflictResolutions = useCallback(
    async (
      files: File[],
      options: { existingContent?: string },
      resolutions: Record<string, ConflictResolution>
    ): Promise<GenerateSummary> => {
      if (files.length === 0 && !options.existingContent) {
        return { duplicateCount: 0, newCount: 0, allDuplicates: false };
      }
      setGenerating(true);
      setError(null);
      try {
        const newSymbols = await Promise.all(files.map(svgFileToSymbol));
        const existingSymbols = options.existingContent
          ? extractSymbolsFromSprite(options.existingContent)
          : [];
        const existingById = new Map(existingSymbols.map((s) => [s.id, s]));
        const merged: SpriteSymbol[] = [];
        const seen = new Set<string>();
        const pushUnique = (s: SpriteSymbol) => {
          if (seen.has(s.id)) return;
          seen.add(s.id);
          merged.push(s);
        };
        // 1. Carry over every existing symbol that wasn't conflicted.
        for (const ex of existingSymbols) {
          if (!resolutions[ex.id]) pushUnique(ex);
        }
        let newCount = 0;
        let duplicateCount = 0;
        // 2. Walk the staged files and apply the resolution.
        for (const incoming of newSymbols) {
          const existing = existingById.get(incoming.id);
          if (!existing) {
            // Brand-new id — just add it.
            pushUnique(incoming);
            newCount += 1;
            continue;
          }
          duplicateCount += 1;
          const resolution = resolutions[incoming.id];
          if (!resolution || resolution.kind === "replace") {
            pushUnique(incoming);
            newCount += 1;
          } else if (resolution.kind === "skip") {
            // Keep the existing symbol; the staged file is dropped.
            pushUnique(existing);
          } else {
            pushUnique(existing);
            pushUnique({ ...incoming, id: resolution.renamedId });
            newCount += 1;
          }
        }
        const sortedMerged = sortSymbolsById(merged);

        const xml = buildSpriteXml(sortedMerged);
        const blob = new Blob([xml], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        replaceUrl(url);
        setSpriteXml(xml);
        setSymbolIds(sortedMerged.map((s) => s.id));
        xmlRef.current = xml;
        symbolIdsRef.current = sortedMerged.map((s) => s.id);
        return { duplicateCount, newCount, allDuplicates: false };
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to apply conflict resolutions."
        );
        return { duplicateCount: 0, newCount: 0, allDuplicates: false };
      } finally {
        setGenerating(false);
      }
    },
    [replaceUrl]
  );

  const flashCopied = useCallback(() => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, []);

  const copy = useCallback(async () => {
    if (!spriteXml) return;
    try {
      await navigator.clipboard.writeText(spriteXml);
      flashCopied();
    } catch {
      // Fallback for older browsers / insecure contexts.
      const ta = document.createElement("textarea");
      ta.value = spriteXml;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // ignore
      }
      document.body.removeChild(ta);
      flashCopied();
    }
  }, [spriteXml, flashCopied]);

  const openDemo = useCallback(() => {
    if (!spriteXml) return;
    const html = buildDemoHtml(symbolIds, spriteXml);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  }, [spriteXml, symbolIds]);

  const reset = useCallback(() => {
    setError(null);
    setSpriteXml(null);
    setSymbolIds([]);
    xmlRef.current = null;
    symbolIdsRef.current = [];
    replaceUrl(null);
  }, [replaceUrl]);

  // Replace the current sprite output with one loaded from the library. Builds a fresh blob URL for download and updates the refs so the "save to library" flow reads the same data.
  const loadFromLibrary = useCallback(
    (input: { xml: string; symbolIds: string[] }) => {
      setError(null);
      setCopied(false);
      const blob = new Blob([input.xml], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      replaceUrl(url);
      const sortedIds = sortSymbolsById(extractSymbolsFromSprite(input.xml)).map(
        (s) => s.id,
      );
      setSpriteXml(input.xml);
      setSymbolIds(sortedIds);
      xmlRef.current = input.xml;
      symbolIdsRef.current = sortedIds;
    },
    [replaceUrl]
  );

  // Resolve with the freshly generated sprite XML once it lands in the hook. Used by consumers that need the latest value immediately after calling `generate()` (e.g. the "save to library" flow).
  const waitForSprite = useCallback(
    () =>
      new Promise<{ xml: string; symbolIds: string[] }>(resolve => {
        const check = () => {
          if (xmlRef.current) {
            resolve({ xml: xmlRef.current, symbolIds: symbolIdsRef.current });
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      }),
    []
  );

  return {
    generating,
    spriteUrl,
    spriteXml,
    symbolIds,
    error,
    copied,
    generate,
    applyConflictResolutions,
    copy,
    openDemo,
    reset,
    waitForSprite,
    loadFromLibrary,
  };
}
