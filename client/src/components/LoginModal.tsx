// Login modal. Triggers the Google sign-in flow and surfaces auth errors to the user.
import { useState } from "react";
import Modal from "./Modal";
import { useAuth } from "../context/AuthContext";

type LoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const ICON_BASE = {
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type IconProps = {
  className?: string;
  strokeWidth?: number;
};

function LockIcon({ className = "w-8 h-8", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg
      {...ICON_BASE}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}

// function GoogleLogo({ className = "w-5 h-5" }: { className?: string }) {
//   return (
//     <svg
//       viewBox="0 0 48 48"
//       xmlns="http://www.w3.org/2000/svg"
//       className={className}
//       aria-hidden="true"
//     >
//       <path
//         fill="#FFC107"
//         d="M43.611 20.083H42V20H24v8h11.303C33.972 32.91 29.388 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
//       />
//       <path
//         fill="#FF3D00"
//         d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
//       />
//       <path
//         fill="#4CAF50"
//         d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.366 0-9.931-3.066-11.288-7.945l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
//       />
//       <path
//         fill="#1976D2"
//         d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
//       />
//     </svg>
//   );
// }

function MicrosoftLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 23 23"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

type Provider = "google" | "microsoft";

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { loginWithGoogle, loginWithMicrosoft } = useAuth();
  const [submittingProvider, setSubmittingProvider] = useState<Provider | null>(
    null
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function reset() {
    setError("");
    setMessage("");
    setSubmittingProvider(null);
  }

  function close() {
    reset();
    onClose?.();
  }

  async function handleProvider(provider: Provider) {
    setError("");
    setMessage("");
    setSubmittingProvider(provider);
    try {
      const user =
        provider === "google"
          ? await loginWithGoogle()
          : await loginWithMicrosoft();
      const providerLabel =
        provider === "google" ? "Google" : "Microsoft";
      setMessage(`Signed in as ${user.email} (${providerLabel})`);
      setTimeout(close, 400);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Sign-in cancelled."
      );
    } finally {
      setSubmittingProvider(null);
    }
  }

  const isBusy = submittingProvider !== null;
  const isProvider = (p: Provider) => submittingProvider === p;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      ariaLabel="Library Login"
      maxWidth="max-w-sm"
    >
      <div className="p-8 w-full text-center">
        <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <LockIcon className="w-8 h-8 text-indigo-600" strokeWidth={1.5} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Library Login</h2>
        <p className="text-sm text-slate-500 mb-6">
          Sign in to save sprites to your personal library.
        </p>
        <div className="space-y-3">
          {/* <button
            type="button"
            onClick={() => handleProvider("google")}
            disabled={isBusy}
            className="w-full py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <GoogleLogo className="w-5 h-5" />
            {isProvider("google")
              ? "Opening Google…"
              : "Sign in with Google"}
          </button> */}

          <button
            type="button"
            onClick={() => handleProvider("microsoft")}
            disabled={isBusy}
            className="w-full py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <MicrosoftLogo className="w-5 h-5" />
            {isProvider("microsoft")
              ? "Opening Microsoft…"
              : "Sign in with Microsoft"}
          </button>

          <button
            type="button"
            onClick={close}
            disabled={isBusy}
            className="w-full py-2 mt-2 text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors disabled:opacity-50"
          >
            Cancel / Continue as Guest
          </button>
        </div>
        {message && (
          <p className="mt-4 text-xs font-medium text-emerald-600">{message}</p>
        )}
        {error && (
          <p className="mt-4 text-xs font-medium text-rose-500">{error}</p>
        )}
      </div>
    </Modal>
  );
}
