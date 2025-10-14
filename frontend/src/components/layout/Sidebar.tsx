import { ReactNode } from "react";

interface SidebarProps {
  children: ReactNode;
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="hidden w-72 flex-shrink-0 border-r border-slate-800 bg-slate-900/60 p-4 lg:block">
      {children}
    </aside>
  );
}
