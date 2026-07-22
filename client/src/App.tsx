import "./App.css";
import { useEffect, useRef, useState } from "react";
import Navbar from "./components/Navbar";
import LoginModal from "./components/LoginModal";
import Compiler from "./components/Compiler";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./context/ToastContext";

// One-shot flags persisted in `sessionStorage` so the toast
// survives the `window.location.reload()` triggered by App's
// auth-change effect. We can't fire the toast from LoginModal
// because the reload happens before the toast has a chance to
// render visibly. Instead we stash a marker before the reload
// lands and consume it on the next mount.
const PENDING_LOGIN_TOAST_KEY = "pendingLoginToast";
const PENDING_LOGOUT_TOAST_KEY = "pendingLogoutToast";

function App() {
  const [showLoginModal, setShowLoginModal] = useState(false);
  // The library side panel starts open so signed-out users can
  // immediately see the "Sign in required" gate, and signed-in
  // users can see their sprites. State lives here so the Navbar's
  // expand button and the Compiler stay in sync.
  const [libraryOpen, setLibraryOpen] = useState(true);

  const { currentUser, initializing } = useAuth();
  const { showToast } = useToast();
  // Auto-refresh the page when the user signs in or out. A full
  // reload is the simplest reliable way to drop all in-memory
  // state (file staging, draft preview CSS, open modals, etc.)
  // and re-fetch the library list with the new credential. We
  // skip the initial rehydration so the page doesn't reload on
  // first paint.
  const previousAuthKeyRef = useRef<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (initializing) return;
    const currentKey = currentUser ? currentUser.id : null;
    if (previousAuthKeyRef.current === undefined) {
      previousAuthKeyRef.current = currentKey;
      return;
    }
    if (previousAuthKeyRef.current !== currentKey) {
      // Stage a toast marker before the reload so the success
      // / failure message can re-fire on the freshly-mounted
      // app. Without this, `window.location.reload()` wipes the
      // toast viewport before the user can see anything.
      // We only stage a marker when transitioning *into* a
      // signed-in state — the logout toast is already fired
      // by Navbar (before the reload) and lives in the same
      // session, but the page reload races the toast viewport
      // there too, so we stage a marker for both transitions
      // to be safe. The login marker carries the signed-in
      // email so the consumer effect can render
      // "Welcome, {email}!" instead of a generic message.
      if (currentKey && currentUser) {
        sessionStorage.setItem(
          PENDING_LOGIN_TOAST_KEY,
          currentUser.email
        );
      } else {
        sessionStorage.setItem(PENDING_LOGOUT_TOAST_KEY, "1");
      }
      // `window.location.reload()` is safe to call here: by the
      // time the effect fires, the auth context has already
      // persisted the new session / cleared localStorage, so the
      // reloaded app will boot into the correct state.
      window.location.reload();
    }
  }, [currentUser, initializing]);

  // Consume any pending auth-toast marker on the first render
  // after a reload. Mounted as a separate effect so the toast
  // fires once and doesn't re-fire on subsequent renders.
  // The login marker carries the signed-in email so the toast
  // can greet the user by name. The logout marker is a bare
  // "1" because we don't need any context for that message.
  useEffect(() => {
    if (initializing) return;
    const loginEmail = sessionStorage.getItem(PENDING_LOGIN_TOAST_KEY);
    if (loginEmail) {
      sessionStorage.removeItem(PENDING_LOGIN_TOAST_KEY);
      showToast(`Welcome, ${loginEmail}`, "success");
      return;
    }
    if (sessionStorage.getItem(PENDING_LOGOUT_TOAST_KEY) === "1") {
      sessionStorage.removeItem(PENDING_LOGOUT_TOAST_KEY);
      showToast("Logged out successfully", "success");
    }
  }, [initializing, showToast]);

  return (
    <div className="min-h-screen bg-mesh bg-slate-50 font-sans text-slate-800 antialiased selection:bg-indigo-200 selection:text-indigo-900">
      <Navbar
        onOpenLogin={() => setShowLoginModal(true)}
        libraryToggleSlot={
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className={`rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 ${
              libraryOpen ? "hidden" : ""
            }`}
            title="Expand Library"
            aria-label="Expand Library"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 5l7 7-7 7M5 5l7 7-7 7"
              />
            </svg>
          </button>
        }
      />
      <Compiler
        onRequireAuth={() => setShowLoginModal(true)}
        libraryOpen={libraryOpen}
        onLibraryToggle={setLibraryOpen}
      />
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
      />
    </div>
  );
}

export default App;
