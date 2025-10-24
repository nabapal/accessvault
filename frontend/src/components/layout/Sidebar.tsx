import { ReactNode } from "react";

interface SidebarProps {
  children: ReactNode;
}

export function Sidebar({ children }: SidebarProps) {
  if (!children) {
    return null;
  }
  return (
    <aside className="hidden w-72 flex-shrink-0 border-r border-brand-800 bg-brand-900/70 p-4 lg:block">
      {children}
    </aside>
  );
}
