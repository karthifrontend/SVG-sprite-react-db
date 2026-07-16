import "./App.css";
import { useEffect, useRef, useState } from "react";
import Navbar from "./components/Navbar";
import LoginModal from "./components/LoginModal";
import Compiler from "./components/Compiler";
import { useAuth } from "./context/AuthContext";

function App() {
  const [showLoginModal, setShowLoginModal] = useState(false);
  // The library side panel starts open so signed-out users can
  // immediately see the "Sign in required" gate, and signed-in
  // users can see their sprites. State lives here so the Navbar's
  // expand button and the Compiler stay in sync.
  const [libraryOpen, setLibraryOpen] = useState(true);

  const { currentUser, initializing } = useAuth();
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
      // `window.location.reload()` is safe to call here: by the
      // time the effect fires, the auth context has already
      // persisted the new session / cleared localStorage, so the
      // reloaded app will boot into the correct state.
      window.location.reload();
    }
  }, [currentUser, initializing]);

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
