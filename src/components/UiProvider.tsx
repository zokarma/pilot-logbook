"use client";

// App-wide confirm dialogs + undo toasts, replacing the browser's native
// confirm() popups (which clash with the cockpit theme and look out of place
// inside the iOS shell).
//
// useUi().confirmDialog(opts) → Promise<boolean> — themed modal, Escape or
// backdrop click cancels. Reserved for destructive actions that can't offer
// Undo (bulk deletes, pilot merges, account deletion).
// useUi().toast(message, {actionLabel, onAction}) — transient bottom toast;
// the delete-with-Undo pattern for single-entity deletes.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface UiApi {
  confirmDialog: (opts: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, opts?: ToastOptions) => void;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}

type DialogState = ConfirmOptions & { resolve: (ok: boolean) => void };
type ToastState = { id: number; message: string; actionLabel?: string; onAction?: () => void };

export default function UiProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeq = useRef(0);

  const confirmDialog = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })),
    [],
  );

  const closeDialog = useCallback((ok: boolean) => {
    setDialog((d) => {
      d?.resolve(ok);
      return null;
    });
  }, []);

  const toast = useCallback((message: string, opts: ToastOptions = {}) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = ++toastSeq.current;
    setToastState({ id, message, actionLabel: opts.actionLabel, onAction: opts.onAction });
    toastTimer.current = setTimeout(
      () => setToastState((t) => (t?.id === id ? null : t)),
      opts.duration ?? 8000,
    );
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, closeDialog]);

  return (
    <UiContext.Provider value={{ confirmDialog, toast }}>
      {children}

      {dialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeDialog(false); }}
        >
          <div className="modal-card w-full max-w-sm p-5" role="alertdialog" aria-modal="true" aria-label={dialog.title}>
            <h3 className="font-semibold mb-2">{dialog.title}</h3>
            <p className="text-sm text-slate-300 whitespace-pre-line">{dialog.message}</p>
            <div className="flex justify-end gap-3 mt-5">
              {/* Cancel takes initial focus so Enter never destroys by accident. */}
              <button
                autoFocus
                onClick={() => closeDialog(false)}
                className="text-sm font-medium text-slate-300 hover:text-white px-3 py-2"
              >
                {dialog.cancelLabel || "Cancel"}
              </button>
              <button
                onClick={() => closeDialog(true)}
                className={
                  "text-sm font-medium text-white px-4 py-2 rounded-lg transition " +
                  (dialog.danger ? "bg-red-600/90 hover:bg-red-600" : "bg-brand-600 hover:bg-brand-700")
                }
              >
                {dialog.confirmLabel || "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastState && (
        <div className="fixed bottom-6 inset-x-0 z-[60] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-4 modal-card px-4 py-3 shadow-xl">
            <span className="text-sm text-slate-200">{toastState.message}</span>
            {toastState.actionLabel && (
              <button
                onClick={() => { toastState.onAction?.(); setToastState(null); }}
                className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
              >
                {toastState.actionLabel}
              </button>
            )}
            <button onClick={() => setToastState(null)} className="text-slate-500 hover:text-slate-300 leading-none" aria-label="Dismiss">
              &times;
            </button>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}
