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
  // When multiple modals are stacked (e.g. an icon-conflict popup
  // on top of a per-row popup) passing `true` ensures that pressing
  // Escape only dismisses THIS modal — the listener calls
  // `event.stopImmediatePropagation()` after invoking `onClose`, so
  // any other keydown listener registered on `document` (the parent
  // modal's, for example) will not fire for the same Escape
  // keypress. Use only for modals whose `onClose` is local to a
  // specific surface; the default behaviour stops at this listener,
  // not the underlying document tree.
  stopEscapePropagation?: boolean;
  // Adjusts the z-index of the modal panel relative to other
  // `Modal` instances on the page. Defaults to `z-60`.
  zIndexClass?: string;
  // Backdrop classes (typically the Tailwind `backdrop-blur-*`
  // utility, optionally combined with a `bg-*` colour). Defaults
  // to `backdrop-blur-sm` so every modal gets the standard
  // blurred-glass backdrop out of the box. Callers can pass a
  // different value to:
  //   • swap the blur intensity (e.g. `backdrop-blur-md` for a
  //     more pronounced blur)
  //   • add a backdrop colour (e.g.
  //     `"backdrop-blur-sm bg-slate-900/80"` for a stacked
  //     modal that needs to stand out from its parent)
  //   • disable the blur entirely (e.g. `""` for a flat
  //     backdrop)
  // The prop is a *replacement*, not an *addition* — the
  // default is applied only when the caller doesn't supply a
  // value, so passing `backdropClassName` never stacks on top
  // of the default.
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
  // Default backdrop to the standard `backdrop-blur-sm` so
  // every modal gets the blurred-glass effect out of the box.
  // Callers can override by passing their own `backdropClassName`
  // (see the prop's JSDoc for the supported patterns). The
  // default-parameter destructure means `${backdropClassName}`
  // in the className is always a valid string — no `??` fallback
  // needed at the call site, and no risk of an unquoted Tailwind
  // class identifier leaking into the template literal.
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
          // Prevent any other `keydown` listener registered on
          // `document` (e.g. the parent modal's own Escape
          // listener) from also handling this Escape keypress.
          // Stack-scoped so a stacked modal's Escape doesn't
          // cascade into the modal beneath it.
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
