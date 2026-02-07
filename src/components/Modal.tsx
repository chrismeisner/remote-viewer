"use client";

import { ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  /** Max width class, defaults to max-w-md */
  maxWidth?: string;
  /** Whether clicking backdrop closes modal */
  closeOnBackdrop?: boolean;
};

export function Modal({
  open,
  onClose,
  children,
  maxWidth = "max-w-md",
  closeOnBackdrop = true,
}: ModalProps) {
  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (closeOnBackdrop && onClose) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 px-4 pt-6 pb-32 sm:py-4"
      onClick={handleBackdropClick}
    >
      <div
        className={`relative w-full ${maxWidth} rounded-md border border-white/15 bg-neutral-900/90 p-6 text-neutral-100 shadow-2xl shadow-black/60 backdrop-blur sm:max-h-[90vh] sm:overflow-y-auto`}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export function ModalTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-2xl font-semibold text-neutral-50 font-homevideo tracking-tight">
      {children}
    </h2>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

export function ModalButton({
  children,
  onClick,
  variant = "default",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const baseClasses =
    "w-full sm:w-auto rounded-md border px-4 py-2 text-sm font-semibold text-neutral-100 transition";
  const variantClasses =
    variant === "primary"
      ? "border-emerald-400/40 bg-emerald-500/20 hover:border-emerald-400/60 hover:bg-emerald-500/30"
      : "border-white/20 bg-white/10 hover:border-white/40 hover:bg-white/15";
  const disabledClasses = disabled ? "opacity-50 cursor-not-allowed" : "";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses} ${disabledClasses}`}
    >
      {children}
    </button>
  );
}
