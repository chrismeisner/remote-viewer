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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-4"
      onClick={handleBackdropClick}
    >
      <div
        className={`w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-md border border-white/15 bg-neutral-900/90 p-6 text-neutral-100 shadow-2xl shadow-black/60 backdrop-blur`}
      >
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
  return <div className="mt-4 flex justify-end gap-2">{children}</div>;
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
    "rounded-md border px-4 py-2 text-sm font-semibold text-neutral-100 transition";
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
