// useSpriteCompiler. Owns the compile state machine: queue icons, merge/update, build sprite XML, and emit demo HTML.
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

// One row in the conflict UI: a symbol id that exists in BOTH the base
// sprite and the staged files. Carries the full `SpriteSymbol` for each
// side so the modal can render an inline SVG preview + size for both
// without re-parsing the XML.
export type IconConflict = {
  id: string;
  existing: SpriteSymbol;
  incoming: SpriteSymbol;
};

// Per-conflict resolution chosen by the user. The conflict UI lets the
// user pick ONE of three actions per row:
//   • "replace" — the new (incoming) symbol wins; the existing one is
//     discarded. Same as the previous default behaviour.
//   • "skip"    — the existing symbol wins; the new one is dropped. The
//     sprite ends up identical to the base for this id.
//   • "both"    — both symbols are kept. The incoming one is renamed to
//     `renamedId` (which the modal computes with a numeric suffix so it
//     doesn't collide with any other symbol in the merged sprite).
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
      setSpriteXml(null);
      setSymbolIds([]);
      xmlRef.current = null;
      symbolIdsRef.current = [];
      replaceUrl(null);
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
        // CONFLICT-MODAL PAUSE: when in update mode AND at least one
        // staged file collides with an existing id, pause and return
        // the conflict list. This covers BOTH the "some new + some
        // duplicate" case AND the "all duplicates" case — the user
        // gets the same Windows-Explorer-style "Replace or Skip
        // Files" modal either way, so they can pick Replace / Skip /
        // Compare per icon. We do NOT short-circuit on the all-
        // duplicates case anymore: the user explicitly asked for the
        // "all duplicates" case to show the conflict popup so they
        // can choose whether to overwrite each existing icon with
        // the new version, leave the base sprite untouched (skip
        // all), or keep both. `allDuplicates` is kept on the summary
        // shape for type back-compat but the value is always `false`
        // now. The caller (Compiler) opens the conflict modal; once
        // the user has chosen a per-confict action, the caller
        // invokes `applyConflictResolutions` with the result to do
        // the actual merge. We do NOT touch sprite state here — that
        // way the user's in-progress dropzone / base-sprite /
        // inline-save state is preserved across the modal
        // interaction.
        if (existingSymbols.length > 0 && duplicateCount > 0) {
          const conflicts: IconConflict[] = newSymbols
            .filter((s) => existingIds.has(s.id))
            .map((s) => {
              const existing = existingById.get(s.id);
              if (!existing) {
                // Defensive: existingIds and existingById are built
                // from the same array so this is unreachable, but TS
                // doesn't know that. Fall back to a placeholder
                // SpriteSymbol — the modal would render an empty
                // preview rather than crash.
                return { id: s.id, existing: s, incoming: s };
              }
              return { id: s.id, existing, incoming: s };
            });
          return {
            duplicateCount,
            newCount: 0,
            allDuplicates: false,
            needsConfirmation: true,
            conflicts,
          };
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

  // Apply the user's per-conflict resolutions and produce the final
  // merged sprite. The caller MUST have already opened the conflict
  // modal via a `generate()` call that returned `needsConfirmation:
  // true`; this function is the second half of that flow and does the
  // actual merge / blob / state-update that `generate()` previously
  // did automatically.
  //
  //   • `replace` — incoming symbol wins; existing is dropped.
  //   • `skip`    — existing symbol wins; incoming is dropped.
  //   • `both`    — existing is kept verbatim, incoming is renamed to
  //     `resolutions[id].renamedId` (the modal computes this with a
  //     numeric suffix so it never collides with any other id in the
  //     merged sprite).
  //
  // The `duplicateCount` reported in the summary counts every conflict
  // the modal showed (i.e. every staged file that collided with an
  // existing id), regardless of how the user resolved it. The
  // `newCount` counts the resulting freshly-added symbols: includes
  // every "replace" (1 new), every "both" (1 new), and every
  // genuinely-new staged file.
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
        // Build the merged output by walking the staged files in order
        // and applying the user's resolution per id. New (non-colliding)
        // files are always included verbatim.
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
            // Default to "replace" when the user closed the modal
            // without explicitly answering (defensive — the modal
            // forces an answer so this branch shouldn't fire in
            // practice).
            pushUnique(incoming);
            newCount += 1;
          } else if (resolution.kind === "skip") {
            // Keep the existing symbol; the staged file is dropped.
            pushUnique(existing);
          } else {
            // "both" — keep the existing one and add the incoming one
            // under its renamed id. The modal guarantees
            // `renamedId` is unique against the merged sprite, so we
            // can `pushUnique` without further de-duplication work.
            pushUnique(existing);
            pushUnique({ ...incoming, id: resolution.renamedId });
            newCount += 1;
          }
        }

        const xml = buildSpriteXml(merged);
        const blob = new Blob([xml], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        replaceUrl(url);
        setSpriteXml(xml);
        setSymbolIds(merged.map((s) => s.id));
        xmlRef.current = xml;
        symbolIdsRef.current = merged.map((s) => s.id);
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
      setSpriteXml(input.xml);
      setSymbolIds(input.symbolIds);
      xmlRef.current = input.xml;
      symbolIdsRef.current = input.symbolIds;
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
