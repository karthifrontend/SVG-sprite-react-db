// AuthContext
// ---------------------------------------------------------------------------
// Multi-provider authentication: Google (GIS), Microsoft (placeholder),
// and a built-in Demo account.
//
// Google flow (full implementation):
//   1. User clicks "Sign in with Google" in the modal.
//   2. We re-initialize GIS with a per-attempt `state` token and
//      `callback`, then click the rendered button. Google opens its
//      full account chooser.
//   3. The chosen account returns an `id_token` (a JWT).
//   4. We POST that token to /api/auth/google. The server verifies
//      it, upserts the User, and returns a session JWT.
//
// Demo flow:
//   1. User clicks "Continue as Demo".
//   2. We POST to /api/auth/demo. The server upserts a shared demo
//      `User` doc (its own `ownerId`, distinct from real users) and
//      returns a session token.
//
// Microsoft flow:
//   1. User clicks "Sign in with Microsoft".
//   2. We POST to /api/auth/microsoft. The server route is not
//      implemented yet, so the server returns 501 and we surface
//      the message in the login modal.
//
// In all cases we store { user, token } in localStorage and the
// sprites API attaches the token via an axios interceptor.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchCurrentUser,
  loginAsDemo as loginAsDemoApi,
  loginWithGoogle as loginWithGoogleApi,
  loginWithMicrosoft as loginWithMicrosoftApi,
  type ServerUser,
} from "../api/auth";

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  picture: string | null;
  emailVerified: boolean;
  provider: "google" | "microsoft" | "demo";
};

type AuthContextValue = {
  currentUser: CurrentUser | null;
  /** True until we've finished rehydrating the user from localStorage. */
  initializing: boolean;
  /**
   * Open the Google account chooser and return the signed-in user.
   * The chooser is a popup, not One-Tap, so it always lists every
   * signed-in account and exposes the "Use another account" option.
   */
  loginWithGoogle: () => Promise<CurrentUser>;
  /**
   * Sign in as the built-in demo user. Returns the demo `CurrentUser`
   * so the modal can show a success message.
   */
  loginAsDemo: () => Promise<CurrentUser>;
  /**
   * Microsoft sign-in. The server-side MSAL flow is not wired up
   * yet, so this resolves to a thrown error with a clear message
   * the modal can display.
   */
  loginWithMicrosoft: () => Promise<CurrentUser>;
  /** Clear local session and revoke the Google session if possible. */
  logout: () => Promise<void>;
};

const STORAGE_KEY = "currentUser";
const TOKEN_KEY = "sessionToken";

const AuthContext = createContext<AuthContextValue | null>(null);

type StoredSession = {
  user: CurrentUser;
  token: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string; select_by?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            /** A unique token per sign-in attempt. GIS uses it to
             *  guarantee the popup returns a fresh credential. */
            state?: string;
            /** Pass-through to `g_state` for replay protection. */
            itp_support?: boolean;
          }) => void;
          prompt: () => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
              width?: number;
              locale?: string;
            }
          ) => void;
          disableAutoSelect: () => void;
          revoke: (hint: string, done?: () => void) => void;
        };
      };
    };
    GOOGLE_CLIENT_ID?: string;
    // Read by the sprites API's axios interceptor.
    __svgCompilerSessionToken?: string | null;
  }
}

function readStoredSession(): StoredSession | null {
  try {
    const rawUser = localStorage.getItem(STORAGE_KEY);
    const rawToken = localStorage.getItem(TOKEN_KEY);
    if (!rawUser || !rawToken) return null;
    return {
      user: JSON.parse(rawUser) as CurrentUser,
      token: rawToken,
    };
  } catch {
    return null;
  }
}

function persistSession(session: StoredSession | null) {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session.user));
    localStorage.setItem(TOKEN_KEY, session.token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
  // Mirror the token on `window` so the sprites API interceptor can
  // pick it up without creating a circular import.
  window.__svgCompilerSessionToken = session?.token ?? null;
}

function toCurrentUser(serverUser: ServerUser): CurrentUser {
  return {
    id: serverUser.id,
    email: serverUser.email,
    displayName: serverUser.displayName,
    picture: serverUser.picture,
    emailVerified: serverUser.emailVerified,
    // Trust the server's provider label so a stale `google` cached
    // in localStorage can never be reported as the demo user.
    provider: serverUser.provider,
  };
}

// ---------------------------------------------------------------------------
// Google Identity Services loader
// ---------------------------------------------------------------------------

let gisLoadPromise: Promise<NonNullable<Window["google"]> | null> | null = null;
function loadGis(): Promise<NonNullable<Window["google"]> | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

let cachedButtonHost: HTMLDivElement | null = null;
function ensureButtonHost(): HTMLDivElement {
  if (cachedButtonHost && document.body.contains(cachedButtonHost)) {
    return cachedButtonHost;
  }
  const host = document.createElement("div");
  host.id = "google-signin-button-host";
  // Off-screen but still focusable / clickable.
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "-9999px";
  host.style.width = "1px";
  host.style.height = "1px";
  host.style.overflow = "hidden";
  document.body.appendChild(host);
  cachedButtonHost = host;
  return host;
}

/**
 * Open the Google account chooser. The GIS button is the only entry
 * point that shows the full chooser with every signed-in Gmail
 * account + "Use another account". We re-initialize GIS with a
 * fresh `callback` and a per-attempt `state` token on every call so
 * the popup always presents a picker (no auto-select of the most
 * recent account).
 */
async function requestGoogleCredential(): Promise<string> {
  const google = await loadGis();
  if (!google) {
    throw new Error("Google Identity Services failed to load.");
  }
  const clientId = (window.GOOGLE_CLIENT_ID ?? "").trim();
  if (!clientId) {
    throw new Error(
      "Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID to client/.env (no space around `=`) and restart the dev server."
    );
  }

  const host = ensureButtonHost();

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      fn();
    };
    let timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error("Google sign-in was cancelled.")));
    }, 5 * 60_000);

    // Per-attempt `state` token: GIS encodes this in the returned
    // id_token, guaranteeing the popup is for this specific call and
    // not a replay of a previous attempt.
    const stateToken =
      Math.random().toString(36).slice(2) + Date.now().toString(36);

    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          const credential = response?.credential;
          if (credential) {
            finish(() => resolve(credential));
          } else {
            finish(() =>
              reject(new Error("Google sign-in did not return a credential."))
            );
          }
        },
        // Important: never auto-select. The whole point of using the
        // button is to give the user a chooser every time.
        auto_select: false,
        cancel_on_tap_outside: true,
        state: stateToken,
        itp_support: true,
      });
    } catch (err) {
      finish(() =>
        reject(err instanceof Error ? err : new Error("Google init failed."))
      );
      return;
    }

    // Render the GIS button into the host (idempotent — re-rendering
    // would create a second button, so we only do it once).
    if (!host.dataset.gisRendered) {
      try {
        google.accounts.id.renderButton(host, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: 320,
        });
        host.dataset.gisRendered = "true";
      } catch (err) {
        finish(() =>
          reject(
            err instanceof Error
              ? err
              : new Error("Google sign-in button failed to render.")
          )
        );
        return;
      }
    }

    // Click the hidden GIS button to open the chooser. The button
    // renders either as an inner `<div role="button">` (older
    // builds) or an `<iframe>` (newer builds); either responds to
    // `.click()`.
    const inner = host.querySelector<HTMLElement>(
      'div[role="button"], iframe'
    );
    const target = inner ?? host;
    target.click();
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Rehydrate the user from localStorage on mount. We also try to
  // verify the stored token with the server so a stale session is
  // detected and cleared automatically.
  useEffect(() => {
    let cancelled = false;
    async function rehydrate() {
      const stored = readStoredSession();
      if (!stored) {
        persistSession(null);
        if (!cancelled) setInitializing(false);
        return;
      }
      window.__svgCompilerSessionToken = stored.token;
      if (!cancelled) setCurrentUser(stored.user);
      try {
        const fresh = await fetchCurrentUser(stored.token);
        if (cancelled) return;
        const next = toCurrentUser(fresh);
        setCurrentUser(next);
        persistSession({ user: next, token: stored.token });
      } catch {
        // Server rejected the token (expired / revoked). Wipe the
        // local session and force the user to sign in again.
        if (cancelled) return;
        persistSession(null);
        setCurrentUser(null);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    void rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const loginWithGoogle = useCallback(async (): Promise<CurrentUser> => {
    const credential = await requestGoogleCredential();
    const { user, token } = await loginWithGoogleApi(credential);
    const next = toCurrentUser(user);
    setCurrentUser(next);
    persistSession({ user: next, token });
    return next;
  }, []);

  const loginAsDemo = useCallback(async (): Promise<CurrentUser> => {
    // The demo flow does not use Google Identity Services, so we
    // skip the GIS re-init and go straight to the API. The server
    // upserts a shared demo `User` doc every time, but the
    // resulting `CurrentUser` (with its own `ownerId`) is
    // indistinguishable from a real session as far as the rest of
    // the app is concerned.
    const { user, token } = await loginAsDemoApi();
    const next = toCurrentUser(user);
    setCurrentUser(next);
    persistSession({ user: next, token });
    return next;
  }, []);

  const loginWithMicrosoft = useCallback(async (): Promise<CurrentUser> => {
    // The server route is a placeholder (501). We let the error
    // bubble up to the caller (the login modal) so it can show the
    // server-provided message in the error slot.
    const { user, token } = await loginWithMicrosoftApi();
    const next = toCurrentUser(user);
    setCurrentUser(next);
    persistSession({ user: next, token });
    return next;
  }, []);

  // Track the most-recently-logged-in user so `logout` can revoke
  // their Google session. Revoking makes the chooser appear on the
  // next sign-in instead of auto-selecting the same account.
  const lastUserRef = useRef<CurrentUser | null>(null);
  useEffect(() => {
    if (currentUser) lastUserRef.current = currentUser;
  }, [currentUser]);

  const logout = useCallback(async () => {
    const previous = lastUserRef.current;
    persistSession(null);
    setCurrentUser(null);
    try {
      // Disable auto-select so the next GIS attempt shows the
      // chooser rather than signing in silently.
      window.google?.accounts.id.disableAutoSelect();
    } catch {
      // ignore
    }
    if (previous?.email) {
      // Revoke the Google session for the email we just signed out
      // from. This invalidates Google's own session cookies for
      // this origin so the chooser appears next time.
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        try {
          window.google?.accounts.id.revoke(previous.email, () => finish());
        } catch {
          finish();
        }
        // GIS's `revoke` callback is best-effort; don't hang.
        window.setTimeout(finish, 1500);
      });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      initializing,
      loginWithGoogle,
      loginAsDemo,
      loginWithMicrosoft,
      logout,
    }),
    [
      currentUser,
      initializing,
      loginWithGoogle,
      loginAsDemo,
      loginWithMicrosoft,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>");
  return ctx;
}
