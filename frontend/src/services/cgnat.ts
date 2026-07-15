import api from "./api";

import {
  CgnatConnectivityResult,
  CgnatDevice,
  CgnatDeviceCreate,
  CgnatDevicePage,
  CgnatInterface,
  CgnatNatPool,
  CgnatStaticRoute,
  CgnatSummary,
  CgnatSyncResult
} from "@/types";

interface FetchCgnatDevicesOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchCgnatDevices = async (options: FetchCgnatDevicesOptions = {}): Promise<CgnatDevicePage> => {
  const params: Record<string, string> = {};
  if (options.search) params.search = options.search;
  if (typeof options.page === "number") params.page = String(options.page);
  if (typeof options.pageSize === "number") params.page_size = String(options.pageSize);
  const { data } = await api.get<CgnatDevicePage>("/cgnat/devices", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchCgnatSummary = async (): Promise<CgnatSummary> => {
  const { data } = await api.get<CgnatSummary>("/cgnat/summary");
  return data;
};

export const fetchCgnatDevice = async (id: string): Promise<CgnatDevice> => {
  const { data } = await api.get<CgnatDevice>(`/cgnat/devices/${id}`);
  return data;
};

export const fetchCgnatDeviceInterfaces = async (id: string): Promise<CgnatInterface[]> => {
  const { data } = await api.get<CgnatInterface[]>(`/cgnat/devices/${id}/interfaces`);
  return data;
};

export const fetchCgnatDevicePools = async (id: string): Promise<CgnatNatPool[]> => {
  const { data } = await api.get<CgnatNatPool[]>(`/cgnat/devices/${id}/pools`);
  return data;
};

export const fetchCgnatDeviceRoutes = async (id: string): Promise<CgnatStaticRoute[]> => {
  const { data } = await api.get<CgnatStaticRoute[]>(`/cgnat/devices/${id}/routes`);
  return data;
};

export const createCgnatDevice = async (payload: CgnatDeviceCreate): Promise<CgnatDevice> => {
  const { data } = await api.post<CgnatDevice>("/cgnat/devices", payload);
  return data;
};

export type CgnatDeviceUpdate = Partial<CgnatDeviceCreate>;

export const updateCgnatDevice = async (id: string, payload: CgnatDeviceUpdate): Promise<CgnatDevice> => {
  const { data } = await api.patch<CgnatDevice>(`/cgnat/devices/${id}`, payload);
  return data;
};

export const deleteCgnatDevice = async (id: string): Promise<void> => {
  await api.delete(`/cgnat/devices/${id}`);
};

export const syncCgnatDevice = async (id: string): Promise<CgnatSyncResult> => {
  const { data } = await api.post<CgnatSyncResult>(`/cgnat/devices/${id}/sync`);
  return data;
};

export const testCgnatDevice = async (id: string): Promise<CgnatConnectivityResult> => {
  const { data } = await api.post<CgnatConnectivityResult>(`/cgnat/devices/${id}/test`);
  return data;
};
