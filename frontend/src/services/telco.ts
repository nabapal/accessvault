import api from "./api";

import { TelcoConnectivityResult, TelcoOnboardingJob, TelcoSyncResult } from "@/types";

export interface TelcoOnboardingJobUpdatePayload {
  name?: string;
  target_host?: string;
  port?: number;
  username?: string;
  verify_ssl?: boolean;
  description?: string;
  connection_params?: Record<string, unknown>;
  poll_interval_seconds?: number;
  password?: string;
}

export interface TelcoOnboardingJobPayload {
  name: string;
  fabric_type: "aci" | "nxos";
  target_host: string;
  port: number;
  username?: string;
  verify_ssl?: boolean;
  description?: string;
  connection_params?: Record<string, unknown>;
  poll_interval_seconds: number;
  password: string;
  auto_validate?: boolean;
}

export interface TelcoValidationPayload {
  force_fail?: boolean;
  error_message?: string | null;
  password?: string;
}

export const listTelcoOnboardingJobs = async (): Promise<TelcoOnboardingJob[]> => {
  const { data } = await api.get<TelcoOnboardingJob[]>("/telco/onboarding/jobs");
  return data;
};

export const createTelcoOnboardingJob = async (
  payload: TelcoOnboardingJobPayload
): Promise<TelcoOnboardingJob> => {
  const { data } = await api.post<TelcoOnboardingJob>("/telco/onboarding/jobs", payload);
  return data;
};

export const validateTelcoOnboardingJob = async (
  jobId: string,
  payload: TelcoValidationPayload = {}
): Promise<TelcoOnboardingJob> => {
  const { data } = await api.post<TelcoOnboardingJob>(`/telco/onboarding/jobs/${jobId}/validate`, payload);
  return data;
};

export const updateTelcoOnboardingJob = async (
  jobId: string,
  payload: TelcoOnboardingJobUpdatePayload
): Promise<TelcoOnboardingJob> => {
  const { data } = await api.patch<TelcoOnboardingJob>(`/telco/onboarding/jobs/${jobId}`, payload);
  return data;
};

export const testTelcoOnboardingJob = async (jobId: string): Promise<TelcoConnectivityResult> => {
  const { data } = await api.post<TelcoConnectivityResult>(`/telco/onboarding/jobs/${jobId}/test`);
  return data;
};

export const syncTelcoOnboardingJob = async (jobId: string): Promise<TelcoSyncResult> => {
  const { data } = await api.post<TelcoSyncResult>(`/telco/onboarding/jobs/${jobId}/sync`);
  return data;
};

export const deleteTelcoOnboardingJob = async (jobId: string): Promise<void> => {
  await api.delete(`/telco/onboarding/jobs/${jobId}`);
};
