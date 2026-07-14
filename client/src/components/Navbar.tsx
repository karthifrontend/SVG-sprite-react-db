import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { ReactNode } from "react";

type NavbarProps = {
  onOpenLogin: () => void;
  libraryToggleSlot?: ReactNode;
};

function Navbar({ onOpenLogin, libraryToggleSlot }: NavbarProps) {
  const { currentUser, logout } = useAuth();
  const { showToast } = useToast();

  async function handleLogout() {
    await logout();
    showToast("Logged out successfully", "success");
    // Hard-reload the page so every in-memory state (library cache,
    // compiler state, file dropzone, etc.) is reset to a clean
    // signed-out baseline. A soft state reset would risk stale
    // data leaking from the previous session.
    window.location.reload();
  }

  return (
    <nav className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between border-b border-slate-200/60 bg-white/80 px-4 py-3 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {libraryToggleSlot}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
            <svg
              className="h-4 w-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
              />
            </svg>
          </div>
          <span className="font-bold tracking-tight text-slate-800">
            SVG Sprite Compiler
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {currentUser ? (
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-block text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
              {currentUser.email}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-slate-500 hover:text-rose-500 transition-colors"
            >
              Logout
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenLogin}
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors border border-indigo-200 px-3 py-1.5 rounded-lg bg-white shadow-sm"
          >
            Sign in / sign up
          </button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
