import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { BrandMark } from "@/components/layout/BrandMark";

interface SidebarItem {
  label: string;
  to: string;
}

interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

interface SidebarProps {
  sections: SidebarSection[];
  activePath: string;
  isCollapsed: boolean;
  onToggle: () => void;
  extraContent?: ReactNode;
}

export function Sidebar({ sections, activePath, isCollapsed, onToggle, extraContent }: SidebarProps) {
  const widthClass = isCollapsed ? "w-20" : "w-72";

  const isActive = (path: string) => {
    if (path === "/") {
      return activePath === "/";
    }
    if (activePath === path) {
      return true;
    }
    return activePath.startsWith(`${path}/`);
  };

  // The group that owns the current route, so we can open it by default.
  const activeSectionTitle = useMemo(
    () => sections.find((section) => section.items.some((item) => isActive(item.to)))?.title,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, activePath]
  );

  // Accordion state: only the active group is open initially; clicking a header
  // toggles its sub-tabs. Multiple groups may be open at once.
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(activeSectionTitle ? [activeSectionTitle] : [])
  );

  // Keep the current route's group open when navigating (without closing others).
  useEffect(() => {
    if (!activeSectionTitle) {
      return;
    }
    setOpenSections((prev) => {
      if (prev.has(activeSectionTitle)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(activeSectionTitle);
      return next;
    });
  }, [activeSectionTitle]);

  const toggleSection = (title: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  return (
    <aside
      className={`hidden ${widthClass} flex-shrink-0 border-r border-brand-800 bg-brand-900/70 p-4 transition-all duration-200 lg:block`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between">
          {!isCollapsed ? (
            <div className="flex items-center gap-2">
              <BrandMark size={28} />
              <span className="text-sm font-semibold tracking-wide text-white">
                Infra<span className="text-primary-300">Pulse</span>
              </span>
            </div>
          ) : (
            <BrandMark size={28} />
          )}
          <button
            type="button"
            onClick={onToggle}
            className="rounded border border-brand-700 bg-brand-800 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
            aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {isCollapsed ? ">" : "<"}
          </button>
        </div>
  <nav className="mt-6 flex-1 space-y-6 overflow-y-auto">
          {sections.map((section) => {
            const open = openSections.has(section.title);
            // When the sidebar is width-collapsed there is no room for group headers,
            // so all items are shown as icon badges (accordion applies only when expanded).
            const showItems = isCollapsed || open;
            return (
            <div key={section.title}>
              {!isCollapsed ? (
                <button
                  type="button"
                  onClick={() => toggleSection(section.title)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:text-slate-300"
                >
                  <span>{section.title}</span>
                  <span className={`text-[10px] text-slate-600 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
                </button>
              ) : null}
              {showItems ? (
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => {
                  const active = isActive(item.to);
                  const baseClasses =
                    "flex items-center gap-3 rounded-md border border-transparent px-2 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";
                  const activeClasses = active
                    ? "border-primary-500/60 bg-primary-500/15 text-primary-100"
                    : "border-brand-800/60 text-slate-200 hover:border-primary-500/30 hover:bg-brand-800/60";
                  const badgeClasses = active
                    ? "border-primary-500/60 bg-primary-500/15 text-primary-100"
                    : "border-brand-700 bg-brand-900/70 text-slate-300";
                  return (
                    <li key={item.to}>
                      <Link to={item.to} className={`${baseClasses} ${activeClasses}`} title={isCollapsed ? item.label : undefined}>
                        {isCollapsed ? (
                          <span className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-semibold uppercase ${badgeClasses}`}>
                            {item.label.slice(0, 2)}
                          </span>
                        ) : (
                          <span className="truncate">{item.label}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              ) : null}
            </div>
            );
          })}
        </nav>
        {extraContent && !isCollapsed ? <div className="mt-6 border-t border-brand-800/60 pt-4 text-sm text-slate-200">{extraContent}</div> : null}
      </div>
    </aside>
  );
}
