// ToastContext
// ---------------------------------------------------------------------------
// Replaces the imperative `showToast` global from the vanilla app with
// a React-friendly context. Toasts can include optional action buttons
// (used for the Undo/Preview flow when pasting icons into a library).
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

export type ToastType = "success" | "error" | "warning";

type ToastButton = {
  label: string;
  type?: "primary" | "secondary";
  onClick?: () => void;
};

type Toast = {
  id: string;
  message: string;
  type: ToastType;
  buttons: ToastButton[];
  cfg: { bg: string; iconPath: string };
};

type ToastContextValue = {
  showToast: (
    message: string,
    type?: ToastType,
    buttons?: ToastButton[]
  ) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_CONFIG: Record<ToastType, { bg: string; iconPath: string }> = {
  success: { bg: "bg-emerald-500", iconPath: "M5 13l4 4L19 7" },
  error: { bg: "bg-rose-500", iconPath: "M6 18L18 6M6 6l12 12" },
  warning: { bg: "bg-amber-500", iconPath: "M12 9v2m0 4h.01M12 3l9.5 16.5H2.5L12 3z" },
};

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "success", buttons: ToastButton[] = []) => {
      const id = `toast-${++toastCounter}`;
      const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.success;
      const duration = buttons && buttons.length > 0 ? 8000 : 3000;
      setToasts((current) => [...current, { id, message, type, buttons, cfg }]);
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
    },
    []
  );

  const value = useMemo(() => ({ showToast, dismiss }), [showToast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-5 right-5 z-80 flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const { cfg, message, buttons } = toast;
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`${cfg.bg} text-white px-5 py-3.5 rounded-xl toast-shadow flex items-center min-w-65 pointer-events-auto animate-slide-in`}
    >
      <svg
        className="w-5 h-5 shrink-0 mr-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={cfg.iconPath} />
      </svg>
      <span className="text-sm font-medium leading-snug flex-1">{message}</span>
      {buttons && buttons.length > 0 && (
        <div className="flex gap-2 ml-4 border-l border-white/20 pl-4 py-1">
          {buttons.map((button, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                onDismiss(toast.id);
                button.onClick?.();
              }}
              className={
                button.type === "primary"
                  ? "px-3 py-1.5 bg-white text-emerald-600 hover:bg-emerald-50 text-xs font-bold rounded shadow-sm whitespace-nowrap"
                  : "px-3 py-1.5 bg-transparent text-white border border-white/40 hover:bg-white/10 text-xs font-bold rounded whitespace-nowrap"
              }
            >
              {button.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}
