// Generic modal shell used by every overlay (login, demo, edit, save, paste)
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  maxWidth?: string;
  dismissOnBackdrop?: boolean;
  ariaLabel?: string;
  ariaModal?: boolean;
  className?: string;
  stopEscapePropagation?: boolean;
  zIndexClass?: string;
  backdropClassName?: string;
  children: ReactNode;
};

export default function Modal({
  isOpen,
  onClose,
  maxWidth = "max-w-sm",
  dismissOnBackdrop = true,
  ariaLabel,
  ariaModal = true,
  className = "",
  stopEscapePropagation = false,
  zIndexClass = "z-60",
  backdropClassName = "",
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose?.();
        if (stopEscapePropagation) {
          event.stopImmediatePropagation();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, stopEscapePropagation]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center ${backdropClassName} backdrop-blur-sm bg-slate-900/60 transition-opacity duration-300`}
      role={ariaModal ? "dialog" : undefined}
      aria-modal={ariaModal || undefined}
      aria-label={ariaLabel}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className={`bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full ${maxWidth} transform transition-transform duration-300 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
