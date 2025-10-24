import { useMemo } from "react";
import { NavLink } from "react-router-dom";

import { AuthState, useAuthStore } from "@/stores/auth";

export function Header() {
  const user = useAuthStore((state: AuthState) => state.user);
  const logout = useAuthStore((state: AuthState) => state.logout);
  const navItems = useMemo(() => {
    const items = [
      { to: "/inventory", label: "Inventory" },
      { to: "/inventory/virtual-machines", label: "VM Center" },
      { to: "/accessvault", label: "AccessVault" }
    ];
    if (user?.role === "admin") {
      items.splice(1, 0, { to: "/inventory/admin", label: "Inventory Admin" });
    }
    return items;
  }, [user?.role]);

  return (
    <header className="flex items-center justify-between border-b border-brand-800 bg-brand-900/80 px-6 py-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
        <div>
          <h1 className="text-lg font-semibold text-white tracking-wide">InfraPulse</h1>
          <p className="text-xs uppercase tracking-[0.3em] text-primary-200">Unified infrastructure intelligence</p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1 font-medium transition ${
                  isActive
                    ? "bg-primary-500/20 text-primary-200"
                    : "text-slate-300 hover:text-white hover:bg-brand-700/60"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        {user && (
          <div className="text-right text-sm">
            <p className="font-medium text-white">{user.full_name}</p>
            <p className="text-xs text-slate-400">{user.role}</p>
          </div>
        )}
        <button
          type="button"
          className="rounded-md border border-brand-700 bg-brand-800 px-3 py-1 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
          onClick={() => logout()}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
