"use client";

import { useEffect, useRef } from "react";

export type ConfirmDescriptor = {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
};

type ConfirmDialogProps = ConfirmDescriptor & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold text-slate-100"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm text-slate-300">{description}</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow transition ${
              destructive
                ? "bg-rose-500 hover:bg-rose-400 shadow-rose-500/30"
                : "bg-indigo-500 hover:bg-indigo-400 shadow-indigo-500/30"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}