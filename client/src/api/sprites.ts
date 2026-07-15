import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5000";

// Attach the current Google session token (if any) to every request
// so the server's `requireUser` middleware can authenticate the call.
// The token is kept on `window.__svgCompilerSessionToken` by the
// AuthContext so the interceptor can read it without becoming a
// circular import.
declare global {
  interface Window {
    __svgCompilerSessionToken?: string | null;
  }
}

const authApi = axios.create({ baseURL: API_BASE });
authApi.interceptors.request.use((config) => {
  const token = window.__svgCompilerSessionToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export type SavedSprite = {
  id: string;
  name: string;
  bundleName: string;
  version: number;
  symbolCount: number;
  isPublic?: boolean;
  isOwner?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type SpriteSummary = {
  _id: string;
  name: string;
  bundleName: string;
  version: number;
  symbolCount: number;
  isPublic?: boolean;
  /**
   * True when the sprite belongs to the currently signed-in user.
   * `false` for public sprites owned by someone else — the UI uses
   * this to hide rename / delete / load-to-update actions.
   */
  isOwner?: boolean;
  /**
   * Free-form version label supplied by the user at save time
   * (e.g. "v4" or "Added 5 icons"). Stored client-side only — the
   * server doesn't persist it, so this is `undefined` for sprites
   * loaded from MongoDB that were saved before this field was
   * added. The library panel falls back to "v<version>" when the
   * label is missing.
   */
  versionLabel?: string;
  updatedAt?: string;
};

export type SpriteDetail = SavedSprite & {
  xml: string;
  symbolIds: string[];
};

/**
 * Persist a generated sprite to MongoDB Atlas as a new version
 * under the given bundle name. The server computes the next version
 * number; the client only supplies the bundle name + payload.
 * Throws an Error with a human-readable message on failure.
 */
export async function saveSprite(input: {
  name: string;
  bundleName?: string;
  xml: string;
  symbolIds: string[];
  symbolCount: number;
  isPublic?: boolean;
}): Promise<SavedSprite> {
  try {
    const { data } = await authApi.post<SavedSprite>(
      `/api/sprites`,
      {
        ...input,
        bundleName: input.bundleName ?? input.name,
        isPublic: !!input.isPublic,
      },
      { headers: { "Content-Type": "application/json" } }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "save sprite");
  }
}

/**
 * Fetch the list of saved sprite versions (lightweight; no XML payload).
 */
export async function listSprites(): Promise<SpriteSummary[]> {
  try {
    const { data } = await authApi.get<SpriteSummary[]>(`/api/sprites`);
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "load sprite library");
  }
}

/**
 * Fetch the latest version of a sprite bundle by bundle name.
 */
export async function getSprite(name: string): Promise<SpriteDetail> {
  try {
    const { data } = await authApi.get<SpriteDetail>(
      `/api/sprites/${encodeURIComponent(name)}`
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "load sprite");
  }
}

/**
 * Fetch a single sprite version (with XML) by id.
 */
export async function getSpriteById(id: string): Promise<SpriteDetail> {
  try {
    const { data } = await authApi.get<SpriteDetail>(
      `/api/sprites/id/${encodeURIComponent(id)}`
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "load sprite version");
  }
}

/**
 * Update an existing sprite version's XML in place. Does NOT create
 * a new version; for that, use `saveSprite`. Used by the live-demo
 * editor to persist symbol add/remove/rename actions.
 */
export async function putSprite(input: {
  id: string;
  xml: string;
  symbolIds: string[];
  symbolCount: number;
}): Promise<SavedSprite> {
  try {
    const { data } = await authApi.put<SavedSprite>(
      `/api/sprites/${encodeURIComponent(input.id)}`,
      {
        xml: input.xml,
        symbolIds: input.symbolIds,
        symbolCount: input.symbolCount,
      },
      { headers: { "Content-Type": "application/json" } }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "update sprite");
  }
}

/**
 * Rename a sprite bundle. Updates the bundle name on every version
 * server-side, so the client only needs to send the new name.
 */
export async function renameSprite(input: {
  id: string;
  name: string;
}): Promise<{ oldBundleName: string; newBundleName: string; updated: number }> {
  try {
    const { data } = await authApi.patch(
      `/api/sprites/${encodeURIComponent(input.id)}/rename`,
      { name: input.name },
      { headers: { "Content-Type": "application/json" } }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "rename sprite");
  }
}

/**
 * Delete a sprite bundle (every version) from the library.
 */
export async function deleteSprite(input: {
  id: string;
  scope?: "version" | "bundle";
}): Promise<{
  bundleName: string;
  deleted: number;
  remaining?: number;
  version?: number;
  scope: "version" | "bundle";
}> {
  try {
    const scope = input.scope ?? "version";
    const { data } = await authApi.delete(
      `/api/sprites/${encodeURIComponent(input.id)}`,
      { params: { scope: scope === "bundle" ? "bundle" : "version" } }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "delete sprite");
  }
}

function wrapAxiosError(err: unknown, action: string): Error {
  if (axios.isAxiosError(err)) {
    const message =
      (err.response?.data as { error?: string } | undefined)?.error ??
      err.message;
    return new Error(`Failed to ${action}: ${message}`);
  }
  return err instanceof Error ? err : new Error(`Failed to ${action}.`);
}
