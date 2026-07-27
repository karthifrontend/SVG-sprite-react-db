// Root App component. Wires the auth context, navbar, login modal, and the main Compiler view together.
import { useEffect, useRef, useState } from "react";
import Navbar from "./components/Navbar";
import LoginModal from "./components/LoginModal";
import Compiler from "./components/Compiler";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./context/ToastContext";

const PENDING_LOGIN_TOAST_KEY = "pendingLoginToast";
const PENDING_LOGOUT_TOAST_KEY = "pendingLogoutToast";

function App() {
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const { currentUser, initializing } = useAuth();
  const { showToast } = useToast();
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
      if (currentKey && currentUser) {
        sessionStorage.setItem(
          PENDING_LOGIN_TOAST_KEY,
          currentUser.email
        );
      } else {
        sessionStorage.setItem(PENDING_LOGOUT_TOAST_KEY, "1");
      }
      window.location.reload();
    }
  }, [currentUser, initializing]);

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
