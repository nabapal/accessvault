import { ReactNode } from "react";

import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

interface AppShellProps {
  sidebar?: ReactNode;
  children: ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-brand-900 text-slate-100">
      {sidebar ? <Sidebar>{sidebar}</Sidebar> : null}
      <div className="flex flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto bg-brand-800/40 p-6">{children}</main>
      </div>
    </div>
  );
}
