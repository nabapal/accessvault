import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

// Consistent page heading: optional eyebrow + title + optional description,
// with an optional right-aligned actions slot (search, buttons). Standardizes
// the type scale and spacing across pages.
export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary-200">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </header>
  );
}
