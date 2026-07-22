import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { isSpriteSvgFile } from "../utils/sprite";

/**
 * What kind of file a dropzone accepts. A "sprite sheet" is any SVG
 * whose root <svg> contains at least one <symbol>; a "single icon"
 * is any other valid SVG.
 *
 *   - "icons"  : reject sprite sheets (the icon section shouldn't
 *                accept a whole sprite file).
 *   - "sprite" : reject anything that isn't a sprite sheet (the
 *                existing-sprite section shouldn't accept a single
 *                icon).
 */
export type DropzoneAcceptMode = "icons" | "sprite";

/**
 * Payload delivered to the `onRejected` callback when a dropped file
 * doesn't match the dropzone's accept mode.
 *
 *   - kind:     "sprite"  — the user dropped a sprite sheet into
 *               the icon section, OR
 *               "icon"    — the user dropped a single icon into the
 *               sprite section.
 *   - fileName: the offending file's name, so the caller can name
 *               and shame it in a toast.
 */
export type RejectedFile = {
  kind: "sprite" | "icon";
  fileName: string;
};

/**
 * Manages staged SVG files plus the drag/drop + click-to-browse interactions
 * for a dropzone UI. The hook is intentionally UI-agnostic — it returns the
 * props each dropzone section needs.
 *
 * Duplicates (same name + same size) are silently skipped. Callers can
 * receive the number of skipped files via the `onSkipped` callback so they
 * can surface a toast/notice.
 *
 * Wrong-type SVG files (sprite dropped into icon section, or icon
 * dropped into sprite section) are silently filtered out of the
 * staged list and reported via `onRejected` so the caller can
 * surface a toast pointing the user at the correct upload target.
 */
export function useFileDropzone(options?: {
  /** Default: "icons". */
  accept?: DropzoneAcceptMode;
  onSkipped?: (count: number) => void;
  /**
   * Fired once per file that was filtered out because it didn't
   * match the dropzone's `accept` mode. Non-SVG files are NOT
   * reported here — they're silently dropped, since users routinely
   * drop the wrong thing and we don't want to nag.
   */
  onRejected?: (rejected: RejectedFile) => void;
}) {
  const acceptMode: DropzoneAcceptMode = options?.accept ?? "icons";
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Keep the option callbacks in refs so `addFiles` doesn't need to
  // re-create itself on every render.
  const onSkippedRef = useRef(options?.onSkipped);
  onSkippedRef.current = options?.onSkipped;
  const onRejectedRef = useRef(options?.onRejected);
  onRejectedRef.current = options?.onRejected;
  const acceptRef = useRef(acceptMode);
  acceptRef.current = acceptMode;

  const addFiles = useCallback(async (incoming: FileList | null) => {
    if (!incoming) return;
    const svgOnly = Array.from(incoming).filter(f => f.type === "image/svg+xml");
    if (svgOnly.length === 0) return;
    // Classify each SVG against the dropzone's accept mode. We do
    // this serially because `isSpriteSvgFile` reads the file via
    // `File.text()` and we want the toasts / order to match what
    // the user dropped.
    const mode = acceptRef.current;
    const classified: Array<{ file: File; isSprite: boolean }> = [];
    for (const file of svgOnly) {
      // `isSpriteSvgFile` swallows read/parse errors and returns
      // `false`, so a corrupt SVG is just treated as "not a
      // sprite" rather than throwing into the dropzone flow.
      const isSprite = await isSpriteSvgFile(file);
      classified.push({ file, isSprite });
    }
    const accepted: File[] = [];
    for (const { file, isSprite } of classified) {
      // Filter by accept mode. The `kind` we report to the caller
      // is the kind we REJECTED — the file the user should have
      // dropped in the OTHER section.
      const matches =
        mode === "icons" ? !isSprite : isSprite;
      if (!matches) {
        onRejectedRef.current?.({
          kind: isSprite ? "sprite" : "icon",
          fileName: file.name,
        });
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    setFiles(prev => {
      // Build a lookup of files already staged. Use name + size as
      // the dedupe key (size disambiguates identically-named files
      // of different content).
      const seen = new Set(prev.map(f => `${f.name.toLowerCase()}|${f.size}`));
      const merged: File[] = [...prev];
      let skipped = 0;
      for (const file of accepted) {
        const key = `${file.name.toLowerCase()}|${file.size}`;
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        seen.add(key);
        merged.push(file);
      }
      if (skipped > 0) onSkippedRef.current?.(skipped);
      return merged;
    });
  }, []);

  // Append already-constructed File objects to the staged list.
  // Mirrors `addFiles` but skips the FileList -> array conversion
  // and the SVG MIME filter, so callers that produced the File
  // objects themselves (e.g. the "paste into workspace" flow,
  // which builds a `File` from a copied `<svg>` string) can drop
  // them straight in. The filter is intentionally relaxed to
  // accept any `image/svg+xml` file — pastes always come with the
  // right MIME since the LiveDemo constructs them explicitly.
  const appendFiles = useCallback((incoming: File[]) => {
    if (!incoming || incoming.length === 0) return;
    const svgOnly = incoming.filter(f => f.type === "image/svg+xml");
    if (svgOnly.length === 0) return;
    setFiles(prev => [...prev, ...svgOnly]);
  }, []);

  const clear = useCallback(() => setFiles([]), []);

  const removeAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Remove a specific set of staged files by reference. Used by
  // the "Undo paste" flow in the live demo, which needs to take
  // back the exact files it just appended even if the user
  // dropped or removed other files in the meantime. We compare
  // by File identity (the same object reference) so files
  // pasted earlier with the same name aren't accidentally
  // pulled out.
  const removeFiles = useCallback((targets: File[]) => {
    if (!targets || targets.length === 0) return;
    const toRemove = new Set(targets);
    setFiles((prev) => prev.filter((f) => !toRemove.has(f)));
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      addFiles(e.target.files);
      // Reset so the same file can be picked again later.
      e.target.value = "";
    },
    [addFiles]
  );

  return {
    files,
    addFiles,
    appendFiles,
    clear,
    removeAt,
    removeFiles,
    onDrop,
    onDragOver,
    openPicker,
    onFileChange,
    inputRef,
  };
}
