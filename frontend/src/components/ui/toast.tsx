import { useEffect } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon
} from "@heroicons/react/24/outline";
import { create } from "zustand";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    // Auto-dismiss after 5s.
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
}));

// Imperative helper so any code (not just components) can raise a toast:
//   toast.success("Sync started"); toast.error("Failed", err.message)
export const toast = {
  success: (title: string, message?: string) => useToastStore.getState().push({ tone: "success", title, message }),
  error: (title: string, message?: string) => useToastStore.getState().push({ tone: "error", title, message }),
  info: (title: string, message?: string) => useToastStore.getState().push({ tone: "info", title, message }),
  warning: (title: string, message?: string) => useToastStore.getState().push({ tone: "warning", title, message })
};

const TONE: Record<ToastTone, { icon: typeof CheckCircleIcon; classes: string }> = {
  success: { icon: CheckCircleIcon, classes: "border-emerald-500/50 bg-emerald-500/10 text-emerald-100" },
  error: { icon: XCircleIcon, classes: "border-rose-500/50 bg-rose-500/10 text-rose-100" },
  warning: { icon: ExclamationTriangleIcon, classes: "border-amber-500/50 bg-amber-500/10 text-amber-100" },
  info: { icon: InformationCircleIcon, classes: "border-primary-500/50 bg-primary-500/10 text-primary-100" }
};

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const { icon: Icon, classes } = TONE[item.tone];
  return (
    <div className={`flex w-80 max-w-[90vw] items-start gap-3 rounded-lg border p-3 shadow-lg shadow-black/30 backdrop-blur ${classes}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{item.title}</p>
        {item.message ? <p className="mt-0.5 break-words text-xs text-slate-300">{item.message}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        className="shrink-0 rounded p-0.5 text-slate-400 transition hover:text-white"
        aria-label="Dismiss notification"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

// Mounted once at the app root; renders the live toast stack bottom-right.
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  // Guard against SSR / hydration mismatch (no-op in this SPA, keeps hook order stable).
  useEffect(() => {}, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard item={t} />
        </div>
      ))}
    </div>
  );
}
