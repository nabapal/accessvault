import api from "./api";

import {
  CpnrChangeEvent,
  CpnrConnectivityResult,
  CpnrObject,
  CpnrPairComparison,
  CpnrPairSummary,
  CpnrSummary,
  CpnrSyncResult,
  CpnrVm,
  CpnrVmCreate,
  CpnrVmPage
} from "@/types";

interface FetchVmsOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchCpnrVms = async (options: FetchVmsOptions = {}): Promise<CpnrVmPage> => {
  const params: Record<string, string> = {};
  if (options.search) params.search = options.search;
  if (typeof options.page === "number") params.page = String(options.page);
  if (typeof options.pageSize === "number") params.page_size = String(options.pageSize);
  const { data } = await api.get<CpnrVmPage>("/cpnr/vms", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchCpnrSummary = async (): Promise<CpnrSummary> => {
  const { data } = await api.get<CpnrSummary>("/cpnr/summary");
  return data;
};

export const fetchCpnrVm = async (id: string): Promise<CpnrVm> => {
  const { data } = await api.get<CpnrVm>(`/cpnr/vms/${id}`);
  return data;
};

export const fetchCpnrObjects = async (id: string, objectType: string): Promise<CpnrObject[]> => {
  const { data } = await api.get<CpnrObject[]>(`/cpnr/vms/${id}/objects/${objectType}`);
  return data;
};

export const fetchCpnrChanges = async (id: string): Promise<CpnrChangeEvent[]> => {
  const { data } = await api.get<CpnrChangeEvent[]>(`/cpnr/vms/${id}/changes`);
  return data;
};

export const cpnrChangesExportUrl = (id: string): string => `/api/v1/cpnr/vms/${id}/changes/export`;

export const fetchCpnrPairs = async (): Promise<CpnrPairSummary[]> => {
  const { data } = await api.get<CpnrPairSummary[]>("/cpnr/pairs");
  return data;
};

export const fetchCpnrPairComparison = async (pairId: string): Promise<CpnrPairComparison> => {
  const { data } = await api.get<CpnrPairComparison>(`/cpnr/pairs/${encodeURIComponent(pairId)}/comparison`);
  return data;
};

export const createCpnrVm = async (payload: CpnrVmCreate): Promise<CpnrVm> => {
  const { data } = await api.post<CpnrVm>("/cpnr/vms", payload);
  return data;
};

export type CpnrVmUpdate = Partial<CpnrVmCreate>;

export const updateCpnrVm = async (id: string, payload: CpnrVmUpdate): Promise<CpnrVm> => {
  const { data } = await api.patch<CpnrVm>(`/cpnr/vms/${id}`, payload);
  return data;
};

export const deleteCpnrVm = async (id: string): Promise<void> => {
  await api.delete(`/cpnr/vms/${id}`);
};

export const syncCpnrVm = async (id: string): Promise<CpnrSyncResult> => {
  const { data } = await api.post<CpnrSyncResult>(`/cpnr/vms/${id}/sync`);
  return data;
};

export const testCpnrVm = async (id: string): Promise<CpnrConnectivityResult> => {
  const { data } = await api.post<CpnrConnectivityResult>(`/cpnr/vms/${id}/test`);
  return data;
};
