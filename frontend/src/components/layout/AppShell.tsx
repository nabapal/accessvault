import { ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  ChartBarSquareIcon,
  ChartPieIcon,
  CloudArrowDownIcon,
  CpuChipIcon,
  KeyIcon,
  MapPinIcon,
  PlusCircleIcon,
  RectangleGroupIcon,
  ServerIcon,
  ServerStackIcon,
  ShareIcon,
  Squares2X2Icon,
  ViewfinderCircleIcon,
  WrenchScrewdriverIcon
} from "@heroicons/react/24/outline";

import { AppFooter } from "@/components/layout/AppFooter";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

interface AppShellProps {
  children: ReactNode;
  sidebarContent?: ReactNode;
}

const SIDEBAR_SECTIONS = [
  {
    title: "VM Inventory",
    items: [
      { label: "Dashboard", to: "/inventory", icon: ChartBarSquareIcon },
      { label: "VM Center", to: "/inventory/virtual-machines", icon: ServerStackIcon }
    ]
  },
  {
    title: "Data Center Inventory",
    items: [
      { label: "Fabric Summary", to: "/telco/aci/summary", icon: RectangleGroupIcon },
      { label: "Fabric Nodes", to: "/telco/aci", icon: CpuChipIcon },
      { label: "Endpoints", to: "/telco/aci/endpoints", icon: MapPinIcon },
      { label: "Free Ports", to: "/telco/aci/free-ports", icon: ViewfinderCircleIcon },
      { label: "VLANs", to: "/telco/aci/vlans", icon: Squares2X2Icon }
    ]
  },
  {
    title: "IP-MPLS Inventory",
    items: [
      { label: "Summary", to: "/ipmpls/summary", icon: ChartPieIcon },
      { label: "Devices", to: "/ipmpls/devices", icon: ServerIcon },
      { label: "Topology", to: "/ipmpls/topology", icon: ShareIcon }
    ]
  },
  {
    title: "NX-OS Inventory",
    items: [
      { label: "Summary", to: "/nxos/summary", icon: ChartPieIcon },
      { label: "Devices", to: "/nxos/devices", icon: ServerIcon },
      { label: "Topology", to: "/nxos/topology", icon: ShareIcon }
    ]
  },
  {
    title: "CGNAT Inventory",
    items: [
      { label: "Summary", to: "/cgnat/summary", icon: ChartPieIcon },
      { label: "Devices", to: "/cgnat/devices", icon: ServerIcon }
    ]
  },
  {
    title: "Admin",
    items: [
      { label: "Fabric Onboarding", to: "/telco/onboarding", icon: PlusCircleIcon },
      { label: "VM Collectors", to: "/inventory/admin", icon: CloudArrowDownIcon },
      { label: "IP-MPLS Devices", to: "/ipmpls/admin", icon: WrenchScrewdriverIcon },
      { label: "NX-OS Devices", to: "/nxos/admin", icon: WrenchScrewdriverIcon },
      { label: "CGNAT Devices", to: "/cgnat/admin", icon: WrenchScrewdriverIcon }
    ]
  },
  {
    title: "Access Vault",
    items: [
      { label: "Credentials", to: "/accessvault", icon: KeyIcon }
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
        <AppFooter />
      </div>
    </div>
  );
}
