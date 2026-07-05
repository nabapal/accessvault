import { BrandMark } from "@/components/layout/BrandMark";
import { AuthState, useAuthStore } from "@/stores/auth";

export function Header() {
  const user = useAuthStore((state: AuthState) => state.user);
  const logout = useAuthStore((state: AuthState) => state.logout);

  return (
    <header className="flex items-center justify-between border-b border-brand-800 bg-gradient-to-b from-brand-900 to-brand-900/80 px-6 py-4">
      <div className="flex items-center gap-3">
        <BrandMark size={36} />
        <div>
          <h1 className="text-lg font-semibold tracking-wide text-white">
            Infra<span className="text-primary-300">Pulse</span>
          </h1>
          <p className="text-[11px] uppercase tracking-[0.3em] text-primary-200/80">Unified infrastructure intelligence</p>
        </div>
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
