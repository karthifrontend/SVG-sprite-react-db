import { useCallback, useEffect, useState } from "react";
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
};

const EMPTY: LibraryState = {
  sprites: [],
  loading: false,
  error: null,
};

/**
 * Fetches the list of sprite versions saved in MongoDB Atlas.
 * Exposes a `refetch` action so callers (e.g. after a save) can
 * trigger a reload.
 */
export function useLibrary(autoLoad = true): LibraryState & LibraryActions {
  const [state, setState] = useState<LibraryState>(EMPTY);

  const refetch = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const sprites = await listSprites();
      setState({ sprites, loading: false, error: null });
    } catch (err) {
      setState({
        sprites: [],
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load library.",
      });
    }
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
      // Optimistically reflect the new metadata in the local list.
      setState(prev => ({
        ...prev,
        sprites: prev.sprites.map(s =>
          s._id === id
            ? { ...s, symbolCount: updated.symbolCount, updatedAt: updated.updatedAt }
            : s
        ),
      }));
      return {
        _id: updated.id,
        name: updated.name,
        bundleName: updated.bundleName,
        version: updated.version,
        symbolCount: updated.symbolCount,
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
      // Optimistically drop the single version from the local list.
      setState(prev => ({
        ...prev,
        sprites: prev.sprites.filter(s => s._id !== id),
      }));
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
      // Optimistically drop the deleted bundle from the local list
      // so the UI updates instantly even before the refetch lands.
      setState(prev => ({
        ...prev,
        sprites: prev.sprites.filter(
          s => s.bundleName.toLowerCase() !== result.bundleName.toLowerCase()
        ),
      }));
      return result.bundleName;
    },
    []
  );

  useEffect(() => {
    if (autoLoad) {
      void refetch();
    }
  }, [autoLoad, refetch]);

  return {
    ...state,
    refetch,
    updateContent,
    renameBundle,
    deleteVersion,
    deleteBundle,
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
