import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react";

/**
 * Manages staged SVG files plus the drag/drop + click-to-browse interactions
 * for a dropzone UI. The hook is intentionally UI-agnostic — it returns the
 * props each dropzone section needs.
 *
 * Duplicates (same name + same size) are silently skipped. Callers can
 * receive the number of skipped files via the `onSkipped` callback so they
 * can surface a toast/notice.
 */
export function useFileDropzone(options?: {
  onSkipped?: (count: number) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Keep the onSkipped callback in a ref so `addFiles` doesn't need to
  // re-create itself on every render.
  const onSkippedRef = useRef(options?.onSkipped);
  onSkippedRef.current = options?.onSkipped;

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const svgOnly = Array.from(incoming).filter(f => f.type === "image/svg+xml");
    if (svgOnly.length === 0) return;
    setFiles(prev => {
      // Build a lookup of files already staged. Use name + size as the
      // dedupe key (size disambiguates identically-named files of
      // different content).
      const seen = new Set(prev.map(f => `${f.name.toLowerCase()}|${f.size}`));
      const accepted: File[] = [];
      let skipped = 0;
      for (const file of svgOnly) {
        const key = `${file.name.toLowerCase()}|${file.size}`;
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        seen.add(key);
        accepted.push(file);
      }
      if (skipped > 0) onSkippedRef.current?.(skipped);
      return [...prev, ...accepted];
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
    onDrop,
    onDragOver,
    openPicker,
    onFileChange,
    inputRef,
  };
}
