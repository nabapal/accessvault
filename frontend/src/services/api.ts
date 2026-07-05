import axios, { InternalAxiosRequestConfig } from "axios";

import { TokenResponse } from "@/types";

const api = axios.create({
  baseURL: "/api/v1",
  headers: {
    "Content-Type": "application/json"
  }
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const setToken = (token: string) => {
  localStorage.setItem("access_token", token);
};

export const clearToken = () => {
  localStorage.removeItem("access_token");
};

export const login = async (email: string, password: string): Promise<TokenResponse> => {
  const formData = new URLSearchParams();
  formData.append("username", email);
  formData.append("password", password);
  const { data } = await api.post<TokenResponse>("/auth/login", formData, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  return data;
};

// Registered by the auth store so a 401 can trigger a logout without this module
// importing the store (which would be a circular import).
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

// When the access token expires every request returns 401. Without handling it the
// UI silently stops showing data; instead clear the session and let ProtectedRoute
// send the user to /login. The login request is excluded so a bad-credentials 401
// surfaces as a form error rather than a redirect.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const requestUrl: string = error?.config?.url ?? "";
    const isLoginRequest = requestUrl.includes("/auth/login");
    if (status === 401 && !isLoginRequest) {
      clearToken();
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

export default api;
