import { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}

// A designed empty state: icon + title + explanation + optional call-to-action.
// Use instead of a bare "No data." string.
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-brand-700 bg-brand-900/40 px-6 py-12 text-center">
      {Icon ? (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-brand-700 bg-brand-800/60 text-slate-400">
          <Icon className="h-6 w-6" />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
