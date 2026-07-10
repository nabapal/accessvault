import api from "./api";

import {
  IpMplsDevice,
  IpMplsDeviceCreate,
  IpMplsDevicePage,
  IpMplsInterface,
  IpMplsModule,
  IpMplsNeighbor,
  IpMplsPlatform,
  IpMplsSummary,
  IpMplsSyncResult,
  IpMplsVrf
} from "@/types";

interface FetchIpMplsDevicesOptions {
  platform?: IpMplsPlatform;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchIpMplsDevices = async (
  options: FetchIpMplsDevicesOptions = {}
): Promise<IpMplsDevicePage> => {
  const params: Record<string, string> = {};
  if (options.platform) {
    params.platform = options.platform;
  }
  if (options.search) {
    params.search = options.search;
  }
  if (typeof options.page === "number") {
    params.page = String(options.page);
  }
  if (typeof options.pageSize === "number") {
    params.page_size = String(options.pageSize);
  }
  const { data } = await api.get<IpMplsDevicePage>("/ipmpls/devices", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchIpMplsSummary = async (): Promise<IpMplsSummary> => {
  const { data } = await api.get<IpMplsSummary>("/ipmpls/summary");
  return data;
};

export const fetchIpMplsDevice = async (deviceId: string): Promise<IpMplsDevice> => {
  const { data } = await api.get<IpMplsDevice>(`/ipmpls/devices/${deviceId}`);
  return data;
};

export const fetchIpMplsDeviceInterfaces = async (deviceId: string): Promise<IpMplsInterface[]> => {
  const { data } = await api.get<IpMplsInterface[]>(`/ipmpls/devices/${deviceId}/interfaces`);
  return data;
};

export const fetchIpMplsDeviceModules = async (deviceId: string): Promise<IpMplsModule[]> => {
  const { data } = await api.get<IpMplsModule[]>(`/ipmpls/devices/${deviceId}/modules`);
  return data;
};

export const fetchIpMplsDeviceVrfs = async (deviceId: string): Promise<IpMplsVrf[]> => {
  const { data } = await api.get<IpMplsVrf[]>(`/ipmpls/devices/${deviceId}/vrfs`);
  return data;
};

export const fetchIpMplsDeviceNeighbors = async (deviceId: string): Promise<IpMplsNeighbor[]> => {
  const { data } = await api.get<IpMplsNeighbor[]>(`/ipmpls/devices/${deviceId}/neighbors`);
  return data;
};

export const createIpMplsDevice = async (payload: IpMplsDeviceCreate): Promise<IpMplsDevice> => {
  const { data } = await api.post<IpMplsDevice>("/ipmpls/devices", payload);
  return data;
};

export type IpMplsDeviceUpdate = Partial<IpMplsDeviceCreate>;

export const updateIpMplsDevice = async (
  deviceId: string,
  payload: IpMplsDeviceUpdate
): Promise<IpMplsDevice> => {
  const { data } = await api.patch<IpMplsDevice>(`/ipmpls/devices/${deviceId}`, payload);
  return data;
};

export interface IpMplsConnectivityResult {
  reachable: boolean;
  message?: string | null;
  hostname?: string | null;
  checked_at: string;
}

export const testIpMplsDevice = async (deviceId: string): Promise<IpMplsConnectivityResult> => {
  const { data } = await api.post<IpMplsConnectivityResult>(`/ipmpls/devices/${deviceId}/test`);
  return data;
};

export const deleteIpMplsDevice = async (deviceId: string): Promise<void> => {
  await api.delete(`/ipmpls/devices/${deviceId}`);
};

export const syncIpMplsDevice = async (deviceId: string): Promise<IpMplsSyncResult> => {
  const { data } = await api.post<IpMplsSyncResult>(`/ipmpls/devices/${deviceId}/sync`);
  return data;
};

export const fetchIpMplsTopology = async (protocol = "isis"): Promise<import("@/types").IpMplsTopology> => {
  const { data } = await api.get<import("@/types").IpMplsTopology>("/ipmpls/topology", { params: { protocol } });
  return data;
};
