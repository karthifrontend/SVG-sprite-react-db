import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteSprite,
  listSprites,
  putSprite,
  renameSprite,
  type SpriteSummary,
} from "../api/sprites";

type LibraryState = {
  sprites: SpriteSummary[];
  loading: boolean;
  error: string | null;
};

type LibraryActions = {
  refetch: () => Promise<void>;
  /**
   * Update an existing sprite version's XML in place. Used by the
   * live-demo editor. Throws on failure; callers can show a toast.
   */
  updateContent: (
    id: string,
    xml: string
  ) => Promise<SpriteSummary>;
  /**
   * Rename a sprite bundle (every version). Returns the new bundle
   * name so callers can keep in-flight references in sync.
   */
  renameBundle: (id: string, name: string) => Promise<string>;
  /**
   * Delete a single sprite version by id. Returns the bundle name
   * and the number of versions remaining so the caller can react
   * (e.g. clear references when the last version is removed).
   */
  deleteVersion: (
    id: string
  ) => Promise<{ bundleName: string; remaining: number; version: number }>;
  /**
   * Delete every version of a sprite bundle. Returns the bundle
   * name that was removed so callers can react to it.
   */
  deleteBundle: (id: string) => Promise<string>;
  /**
   * Set a free-form version label on a single sprite. The label
   * survives subsequent `refetch` calls because the hook caches
   * it in a module-level map keyed by sprite id. Used by the
   * "Save to Organization" flow to remember what the user typed
   * into the Version Description field (the server doesn't
   * persist it).
   */
  setVersionLabel: (id: string, label: string) => void;
};

const EMPTY: LibraryState = {
  sprites: [],
  loading: false,
  error: null,
};

/**
 * Module-level label cache shared by every `useLibrary` consumer in
 * the app. The server doesn't persist version labels, so we keep
 * them client-side. Storing at module scope (instead of inside a
 * `useRef`) is important because the Compiler and the
 * LibraryPanel each create their own `useLibrary` instance — a
 * per-instance ref would only be visible inside the instance that
 * set the label, never to the panel that renders the list.
 */
const versionLabelCache: Map<string, string> = new Map();

/**
 * Module-level broadcast channel for "the library changed" events
 * (new save, delete, rename, paste-into-library). Every
 * `useLibrary` instance subscribes; the one that initiated the
 * change is excluded so we don't fire two refetches for the same
 * write. The Compiler fires this so the LibraryPanel (which has
 * its own `useLibrary` instance) refetches and shows the new
 * entry without the user clicking the refresh button.
 */
const libraryChangedSubscribers: Set<() => void> = new Set();

/** Fire the "library changed" event. Called from outside the hook. */
export function notifyLibraryChanged(): void {
  libraryChangedSubscribers.forEach((fn) => fn());
}

/**
 * Fetches the list of sprite versions saved in MongoDB Atlas.
 * Exposes a `refetch` action so callers (e.g. after a save) can
 * trigger a reload.
 */
export function useLibrary(autoLoad = true): LibraryState & LibraryActions {
  const [state, setState] = useState<LibraryState>(EMPTY);
  // Subscribers listen for cache changes so the panel can re-render
  // when another instance writes a new label.
  const subscribersRef = useRef<Set<() => void>>(new Set());

  const applyLabels = useCallback((sprites: SpriteSummary[]): SpriteSummary[] => {
    if (versionLabelCache.size === 0) return sprites;
    return sprites.map((sprite) => {
      const cached = versionLabelCache.get(sprite._id);
      return cached ? { ...sprite, versionLabel: cached } : sprite;
    });
  }, []);

  const refetch = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const sprites = await listSprites();
      setState({ sprites: applyLabels(sprites), loading: false, error: null });
    } catch (err) {
      setState({
        sprites: [],
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load library.",
      });
    }
  }, [applyLabels]);

  const setVersionLabel = useCallback((id: string, label: string) => {
    versionLabelCache.set(id, label);
    setState((prev) => ({
      ...prev,
      sprites: prev.sprites.map((s) =>
        s._id === id ? { ...s, versionLabel: label } : s,
      ),
    }));
    // Notify sibling instances (e.g. LibraryPanel) so they can
    // re-apply the label onto their own sprites array without
    // having to refetch from the server.
    subscribersRef.current.forEach((fn) => fn());
  }, []);

  const updateContent = useCallback(
    async (id: string, xml: string): Promise<SpriteSummary> => {
      // Parse symbol ids from the XML so the server-side `symbolIds`
      // field stays consistent with the XML. We keep the parsed
      // array client-side too so the caller doesn't have to.
      const symbolIds = extractSymbolIds(xml);
      const updated = await putSprite({
        id,
        xml,
        symbolIds,
        symbolCount: symbolIds.length,
      });
      // Optimistically reflect the new metadata in the local list,
      // and re-apply any cached label so it survives the rewrite.
      const cachedLabel = versionLabelCache.get(id);
      setState(prev => ({
        ...prev,
        sprites: prev.sprites.map(s =>
          s._id === id
            ? {
                ...s,
                symbolCount: updated.symbolCount,
                updatedAt: updated.updatedAt,
                versionLabel: cachedLabel ?? s.versionLabel,
              }
            : s
        ),
      }));
      return {
        _id: updated.id,
        name: updated.name,
        bundleName: updated.bundleName,
        version: updated.version,
        symbolCount: updated.symbolCount,
        versionLabel: cachedLabel,
        updatedAt: updated.updatedAt,
      };
    },
    []
  );

  const renameBundle = useCallback(
    async (id: string, name: string): Promise<string> => {
      const result = await renameSprite({ id, name });
      // Refresh the list so the group title and version names pick
      // up the new bundle name everywhere.
      await refetch();
      return result.newBundleName;
    },
    [refetch]
  );

  const deleteVersion = useCallback(
    async (id: string) => {
      const result = await deleteSprite({ id, scope: "version" });
      // Optimistically drop the single version from the local list
      // and purge its cached label so a future save with the same
      // id (extremely unlikely, but possible across recreates) won't
      // pick up a stale value.
      versionLabelCache.delete(id);
      setState(prev => ({
        ...prev,
        sprites: prev.sprites.filter(s => s._id !== id),
      }));
      // Notify sibling `useLibrary` instances (e.g. the one
      // owned by the Compiler, which uses `librarySprites` to
      // build the "existing library names" conflict list for the
      // "Save to Library" modal). Without this broadcast the
      // Compiler would still see the deleted bundle as live and
      // flag a false-positive name conflict when the user typed
      // the deleted bundle's name back into the modal.
      notifyLibraryChanged();
      return {
        bundleName: result.bundleName,
        remaining: result.remaining ?? 0,
        version: result.version ?? 0,
      };
    },
    []
  );

  const deleteBundle = useCallback(
    async (id: string): Promise<string> => {
      const result = await deleteSprite({ id, scope: "bundle" });
      // Drop the deleted bundle from the local list and purge
      // every cached label that belonged to it.
      const removedKey = result.bundleName.trim().toLowerCase();
      setState(prev => {
        const survivors = prev.sprites.filter(
          s => s.bundleName.toLowerCase() !== removedKey,
        );
        const survivorIds = new Set(survivors.map((s) => s._id));
        for (const cachedId of Array.from(versionLabelCache.keys())) {
          if (!survivorIds.has(cachedId)) versionLabelCache.delete(cachedId);
        }
        return { ...prev, sprites: survivors };
      });
      // Same reason as `deleteVersion` — keep the Compiler's
      // conflict list in sync with the deletion.
      notifyLibraryChanged();
      return result.bundleName;
    },
    []
  );

  useEffect(() => {
    if (autoLoad) {
      void refetch();
    }
  }, [autoLoad, refetch]);

  // Subscribe to the module-level label cache so this instance
  // picks up labels written by sibling instances. We re-apply the
  // cached labels onto the local sprites array — no network
  // request, just a re-render. The dependency on `applyLabels`
  // keeps the effect stable across renders.
  useEffect(() => {
    const subscriber = () => {
      setState((prev) => {
        if (versionLabelCache.size === 0) return prev;
        let changed = false;
        const next = prev.sprites.map((sprite) => {
          const cached = versionLabelCache.get(sprite._id);
          if (cached && cached !== sprite.versionLabel) {
            changed = true;
            return { ...sprite, versionLabel: cached };
          }
          return sprite;
        });
        return changed ? { ...prev, sprites: next } : prev;
      });
    };
    subscribersRef.current.add(subscriber);
    return () => {
      subscribersRef.current.delete(subscriber);
    };
  }, [applyLabels]);

  // Subscribe to the module-level "library changed" channel. When
  // the Compiler saves a new sprite, fires this event, and every
  // other useLibrary instance (e.g. the LibraryPanel's) refetches
  // so the new entry shows up immediately — no need to click the
  // refresh button.
  useEffect(() => {
    const subscriber = () => {
      void refetch();
    };
    libraryChangedSubscribers.add(subscriber);
    return () => {
      libraryChangedSubscribers.delete(subscriber);
    };
  }, [refetch]);

  return {
    ...state,
    refetch,
    updateContent,
    renameBundle,
    deleteVersion,
    deleteBundle,
    setVersionLabel,
  };
}

function extractSymbolIds(xml: string): string[] {
  if (!xml) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "image/svg+xml");
    return Array.from(doc.getElementsByTagName("symbol"))
      .map(el => el.getAttribute("id") || "")
      .filter(id => id.length > 0);
  } catch {
    return [];
  }
}
