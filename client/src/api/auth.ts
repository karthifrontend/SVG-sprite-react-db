// Auth API client. Wraps the server's /api/auth/* routes so the
// rest of the app can stay provider-agnostic.
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5000";

export type ServerUser = {
  id: string;
  email: string;
  displayName: string;
  picture: string | null;
  emailVerified: boolean;
  provider: "google" | "microsoft" | "demo";
  lastLoginAt?: string;
};

export type LoginResponse = {
  user: ServerUser;
  token: string;
};

export async function loginWithGoogle(credential: string): Promise<LoginResponse> {
  try {
    const { data } = await axios.post<LoginResponse>(
      `${API_BASE}/api/auth/google`,
      { credential },
      { headers: { "Content-Type": "application/json" } }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "Google sign-in");
  }
}

/**
 * Sign in as the built-in demo user. The server upserts a shared
 * demo `User` doc (separate `ownerId` from any real account) and
 * returns a session token. No client-side credentials required.
 */
export async function loginAsDemo(): Promise<LoginResponse> {
  try {
    const { data } = await axios.post<LoginResponse>(
      `${API_BASE}/api/auth/demo`,
      {},
      { headers: { "Content-Type": "application/json" } }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "Demo sign-in");
  }
}

/**
 * Microsoft sign-in. The server route is intentionally not
 * implemented yet (returns 501) so the UI can surface a friendly
 * "not configured" message. We keep this call here so the client
 * never has to special-case network errors itself.
 */
export async function loginWithMicrosoft(): Promise<LoginResponse> {
  try {
    const { data } = await axios.post<LoginResponse>(
      `${API_BASE}/api/auth/microsoft`,
      {},
      { headers: { "Content-Type": "application/json" } }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, "Microsoft sign-in");
  }
}

export async function fetchCurrentUser(token: string): Promise<ServerUser> {
  try {
    const { data } = await axios.get<{ user: ServerUser }>(
      `${API_BASE}/api/auth/me`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return data.user;
  } catch (err) {
    throw wrapAxiosError(err, "refresh session");
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
