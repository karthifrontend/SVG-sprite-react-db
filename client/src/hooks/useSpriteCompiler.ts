import { useCallback, useEffect, useRef, useState } from "react";
import { buildDemoHtml, buildSpriteXml, extractSymbolsFromSprite, svgFileToSymbol, type SpriteSymbol } from "../utils/sprite";

type CompilerState = {
  generating: boolean;
  spriteUrl: string | null;
  spriteXml: string | null;
  symbolIds: string[];
  error: string | null;
  copied: boolean;
};

type CompilerActions = {
  /**
   * Run the sprite-generation pipeline on the supplied files.
   * Returns a summary describing what was actually merged into
   * the output sprite. In update mode (`existingContent`
   * provided) the summary reports how many of the staged files
   * produced duplicate symbol ids against the base sprite, so
   * the caller can surface a "skipped N duplicates" toast. When
   * every staged file is a duplicate the hook skips the
   * generation entirely and returns `allDuplicates: true` with
   * no sprite state changes — the caller should treat that as
   * a no-op and bail before any save flow runs.
   */
  generate: (
    files: File[],
    options?: { existingContent?: string }
  ) => Promise<GenerateSummary>;
  copy: () => Promise<void>;
  openDemo: () => void;
  reset: () => void;
  waitForSprite: () => Promise<{ xml: string; symbolIds: string[] }>;
  loadFromLibrary: (input: { xml: string; symbolIds: string[] }) => void;
};

/**
 * Outcome of a `generate()` call. `duplicateCount` is the number
 * of staged files whose symbol id was already present in the
 * base sprite (only meaningful in update mode). `newCount` is
 * the number of staged files that contributed a fresh symbol
 * to the merged output. `allDuplicates` is the short-circuit
 * signal: when true, the hook skipped the generation entirely
 * and the caller should treat the call as a no-op.
 */
export type GenerateSummary = {
  duplicateCount: number;
  newCount: number;
  allDuplicates: boolean;
};

const COPY_FEEDBACK_MS = 1500;

/**
 * Drives the sprite-generation pipeline: turn staged files into a sprite
 * document, build a blob URL for download, and expose copy/demo actions.
 */
export function useSpriteCompiler(): CompilerState & CompilerActions {
  const [generating, setGenerating] = useState(false);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [spriteXml, setSpriteXml] = useState<string | null>(null);
  const [symbolIds, setSymbolIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Keep a ref to the latest blob URL so we can revoke it on unmount/replace.
  const urlRef = useRef<string | null>(null);
  // Mirror of spriteXml/symbolIds so consumers outside the render cycle
  // (e.g. async save flows) can read the freshest values.
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
      setSpriteXml(null);
      setSymbolIds([]);
      xmlRef.current = null;
      symbolIdsRef.current = [];
      replaceUrl(null);
      try {
        const newSymbols = await Promise.all(files.map(svgFileToSymbol));

        // In update mode, pull the existing symbols out of the base
        // sprite and merge them with the new ones. New symbols win
        // when ids collide.
        const existingSymbols = options?.existingContent
          ? extractSymbolsFromSprite(options.existingContent)
          : [];
        // Pre-compute the duplicate set against the base sprite so
        // we can return a summary the caller uses for its toast
        // copy and to short-circuit the all-duplicates case. We
        // compare by symbol id (derived from the staged file's
        // name) — the same id the server-side library merge uses,
        // so a file dropped here that collides with an existing
        // library symbol is treated as a duplicate here too.
        //
        // The short-circuit (`allDuplicates: true`) means: if
        // every staged file produced an id that already lives in
        // the base sprite, we skip the merge / blob / state
        // updates entirely. The caller (`handleGenerate`) then
        // bails before touching the base-sprite file, the inline
        // save state, or the library save flow — there's nothing
        // to save, and creating a "new version" of the sprite
        // with zero net new icons would be misleading.
        const existingIds = new Set(existingSymbols.map((s) => s.id));
        const duplicateCount = newSymbols.filter((s) => existingIds.has(s.id)).length;
        const trulyNewSymbols = newSymbols.filter((s) => !existingIds.has(s.id));
        if (existingSymbols.length > 0 && trulyNewSymbols.length === 0) {
          return { duplicateCount, newCount: 0, allDuplicates: true };
        }
        const seen = new Set<string>();
        const merged: SpriteSymbol[] = [];
        for (const s of [...existingSymbols, ...trulyNewSymbols]) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          merged.push(s);
        }

        const xml = buildSpriteXml(merged);
        const blob = new Blob([xml], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        replaceUrl(url);
        setSpriteXml(xml);
        setSymbolIds(merged.map(s => s.id));
        xmlRef.current = xml;
        symbolIdsRef.current = merged.map(s => s.id);
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
        /* ignore */
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

  /**
   * Replace the current sprite output with one loaded from the library.
   * Builds a fresh blob URL for download and updates the refs so the
   * "save to library" flow reads the same data.
   */
  const loadFromLibrary = useCallback(
    (input: { xml: string; symbolIds: string[] }) => {
      setError(null);
      setCopied(false);
      const blob = new Blob([input.xml], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      replaceUrl(url);
      setSpriteXml(input.xml);
      setSymbolIds(input.symbolIds);
      xmlRef.current = input.xml;
      symbolIdsRef.current = input.symbolIds;
    },
    [replaceUrl]
  );

  /**
   * Resolve with the freshly generated sprite XML once it lands in the
   * hook. Used by consumers that need the latest value immediately after
   * calling `generate()` (e.g. the "save to library" flow).
   */
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
    copy,
    openDemo,
    reset,
    waitForSprite,
    loadFromLibrary,
  };
}
