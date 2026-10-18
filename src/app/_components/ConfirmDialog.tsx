"use client";
import { useEffect, useId, useRef } from "react";
export type ConfirmDescriptor = { title: string; description?: string; confirmLabel: string; cancelLabel: string; destructive?: boolean };
type Props = ConfirmDescriptor & { open: boolean; onConfirm: () => void; onCancel: () => void };

export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, destructive, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) { ref.current?.showModal(); cancel.current?.focus(); }
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={id} aria-describedby={description ? `${id}-body` : undefined}
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onClick={event => { if (event.target === event.currentTarget) onCancel(); }}
    className="fixed m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-slate-950/75 backdrop:backdrop-blur-sm">
    <div className="p-6">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {description && <p id={`${id}-body`} className="mt-2 text-sm text-slate-300">{description}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm">{cancelLabel}</button>
        <button type="button" onClick={onConfirm} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${destructive ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-500 hover:bg-indigo-400"}`}>{confirmLabel}</button>
      </div>
    </div>
  </dialog>;
}
