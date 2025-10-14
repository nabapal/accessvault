import { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { AuthState, useAuthStore } from "@/stores/auth";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const token = useAuthStore((state: AuthState) => state.token);
  const fetchProfile = useAuthStore((state: AuthState) => state.fetchProfile);
  const user = useAuthStore((state: AuthState) => state.user);
  const location = useLocation();

  useEffect(() => {
    if (token && !user) {
      fetchProfile().catch(() => {
        // If profile fetch fails, force logout
        useAuthStore.getState().logout();
      });
    }
  }, [token, user, fetchProfile]);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!user) {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading profile...</div>;
  }

  return <>{children}</>;
}
