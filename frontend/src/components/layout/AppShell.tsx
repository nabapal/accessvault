import { ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

interface AppShellProps {
  children: ReactNode;
  sidebarContent?: ReactNode;
}

const SIDEBAR_SECTIONS = [
  {
    title: "IPSE",
    items: [
      { label: "Dashboard", to: "/inventory" },
      { label: "VM Center", to: "/inventory/virtual-machines" },
      { label: "Collectors Admin", to: "/inventory/admin" },
      { label: "Access Vault", to: "/accessvault" }
    ]
  }
];

const SIDEBAR_STORAGE_KEY = "ui.sidebar.collapsed";

export function AppShell({ children, sidebarContent }: AppShellProps) {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, isCollapsed ? "1" : "0");
  }, [isCollapsed]);

  const sections = useMemo(() => SIDEBAR_SECTIONS, []);

  const handleToggleSidebar = () => {
    setIsCollapsed((prev) => !prev);
  };

  return (
    <div className="flex min-h-screen bg-brand-900 text-slate-100">
      <Sidebar
        sections={sections}
        activePath={location.pathname}
        isCollapsed={isCollapsed}
        onToggle={handleToggleSidebar}
        extraContent={sidebarContent}
      />
      <div className="flex flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto bg-brand-800/40 p-6">{children}</main>
      </div>
    </div>
  );
}
