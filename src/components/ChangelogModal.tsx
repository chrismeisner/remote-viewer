"use client";

import { Modal, ModalTitle, ModalFooter, ModalButton } from "./Modal";

type ChangelogCategory = "addition" | "update" | "removal" | "note";

type ChangelogEntry = {
  id: string;
  date: string;
  message: string;
  category: ChangelogCategory;
};

type ChangelogModalProps = {
  open: boolean;
  onClose: () => void;
  entries: ChangelogEntry[];
};

const CATEGORY_CONFIG: Record<
  ChangelogCategory,
  { label: string; icon: string; bgColor: string; textColor: string; borderColor: string }
> = {
  addition: {
    label: "Addition",
    icon: "+",
    bgColor: "bg-emerald-500/20",
    textColor: "text-emerald-300",
    borderColor: "border-emerald-500/30",
  },
  update: {
    label: "Update",
    icon: "↻",
    bgColor: "bg-blue-500/20",
    textColor: "text-blue-300",
    borderColor: "border-blue-500/30",
  },
  removal: {
    label: "Removal",
    icon: "−",
    bgColor: "bg-red-500/20",
    textColor: "text-red-300",
    borderColor: "border-red-500/30",
  },
  note: {
    label: "Note",
    icon: "•",
    bgColor: "bg-neutral-500/20",
    textColor: "text-neutral-300",
    borderColor: "border-neutral-500/30",
  },
};

export function ChangelogModal({ open, onClose, entries }: ChangelogModalProps) {
  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <ModalTitle>Updates</ModalTitle>
      <p className="mt-3 text-sm text-neutral-300">
        New changes have been made to the media library.
      </p>
      
      <div className="mt-4 max-h-96 overflow-y-auto space-y-2">
        {entries.map((entry) => {
          const config = CATEGORY_CONFIG[entry.category];
          return (
            <div
              key={entry.id}
              className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-3`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex-shrink-0 w-6 h-6 rounded-full ${config.bgColor} ${config.textColor} flex items-center justify-center text-sm font-bold`}
                >
                  {config.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-100">{entry.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-neutral-500">
                      {formatDate(entry.date)}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${config.bgColor} ${config.textColor}`}
                    >
                      {config.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <ModalFooter>
        <ModalButton onClick={onClose} variant="primary">Got it</ModalButton>
      </ModalFooter>
    </Modal>
  );
}
