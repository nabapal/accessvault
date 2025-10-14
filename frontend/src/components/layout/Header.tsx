import { AuthState, useAuthStore } from "@/stores/auth";

export function Header() {
  const user = useAuthStore((state: AuthState) => state.user);
  const logout = useAuthStore((state: AuthState) => state.logout);

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/40 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-white">AccessVault</h1>
        <p className="text-xs text-slate-400">Secure credential automation dashboard</p>
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
          className="rounded-md border border-slate-700 px-3 py-1 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:text-white"
          onClick={() => logout()}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
