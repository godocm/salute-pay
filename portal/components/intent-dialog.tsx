"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function IntentDialog({
  children,
  onClose,
  busy,
}: {
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="intent-dialog"
      aria-label="Intent details"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="intent-dialog-bar">
        <span>INTENT DETAILS</span>
        <button
          autoFocus
          className="icon-button"
          disabled={busy}
          aria-label="Close intent details"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
