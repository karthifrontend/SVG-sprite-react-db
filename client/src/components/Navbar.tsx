// Top navigation bar. Shows the brand, library toggle, and sign-in / user menu.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";

// Build a 1–2 letter avatar label from a display name or email.
function getInitials(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0][0] ?? "") + (parts[1][0] ?? "")).toUpperCase();
  }
  const first = parts[0] ?? trimmed;
  return first.slice(0, 2).toUpperCase();
}

type NavbarProps = {
  onOpenLogin: () => void;
  libraryToggleSlot?: ReactNode;
};

function Navbar({ onOpenLogin, libraryToggleSlot }: NavbarProps) {
  const { currentUser, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the avatar popup when clicking outside the menu container.
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(event: MouseEvent) {
      const container = menuRef.current;
      if (!container) return;
      if (event.target instanceof Node && container.contains(event.target)) {
        return;
      }
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
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
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              className="flex items-center gap-2 rounded-full p-0 transition-all hover:[box-shadow:0_0_0_6px_var(--color-indigo-200)] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Account menu for ${currentUser.displayName || currentUser.email}`}
            >
              {currentUser.picture ? (
                <img
                  src={currentUser.picture}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white shadow-sm">
                  {getInitials(currentUser.displayName || currentUser.email)}
                </span>
              )}
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
              >
                <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-slate-100">
                  {currentUser.picture ? (
                    <img
                      src={currentUser.picture}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white shadow-sm">
                      {getInitials(currentUser.displayName || currentUser.email)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {currentUser.displayName || currentUser.email}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {currentUser.email}
                    </p>
                  </div>
                </div>
                <div className="border-t border-slate-100">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="flex w-full items-center text-left px-3.5 py-2.5 text-sm font-medium text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
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
