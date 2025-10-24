import { ChangeEvent, FormEvent, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { AuthState, useAuthStore } from "@/stores/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state: AuthState) => state.login);
  const isLoading = useAuthStore((state: AuthState) => state.isLoading);
  const error = useAuthStore((state: AuthState) => state.error);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await login(email, password);
      const from = (location.state as { from?: Location })?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (submissionError) {
      console.error("Login failed", submissionError);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 px-4">
      <div className="w-full max-w-md rounded-lg border border-brand-700 bg-brand-900/80 p-8 shadow-xl shadow-black/40">
        <h1 className="mb-2 text-center text-2xl font-semibold text-slate-100 tracking-wide">InfraPulse</h1>
        <p className="mb-6 text-center text-xs uppercase tracking-[0.35em] text-primary-200">Secure operations portal</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-400" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
              className="w-full rounded-md border border-brand-700 bg-brand-900 px-3 py-2 text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              required
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-400" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
              className="w-full rounded-md border border-brand-700 bg-brand-900 px-3 py-2 text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              required
            />
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-primary-600 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
