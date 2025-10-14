import { GetState, SetState, StateCreator, create } from "zustand";
import { persist } from "zustand/middleware";

import { clearToken, login, setToken } from "@/services/api";
import { Role, TokenResponse, User } from "@/types";
import api from "@/services/api";

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  fetchProfile: () => Promise<void>;
  hasRole: (role: Role) => boolean;
}

const storeCreator: StateCreator<AuthState, [], [], AuthState> = (
  set: SetState<AuthState>,
  get: GetState<AuthState>
) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const { access_token }: TokenResponse = await login(email, password);
          setToken(access_token);
          set({ token: access_token });
          await get().fetchProfile();
        } catch (error) {
          set({ error: (error as Error).message });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },
      logout: () => {
        clearToken();
        set({ user: null, token: null });
      },
      fetchProfile: async () => {
        const { data } = await api.get<User>("/auth/me");
        set({ user: data });
      },
      hasRole: (role: Role) => {
        const { user } = get();
        if (!user) return false;
        if (role === "admin") {
          return user.role === "admin";
        }
        return true;
      }
});

export const useAuthStore = create<AuthState>()(
  persist(storeCreator, {
    name: "accessvault-auth"
  })
);
