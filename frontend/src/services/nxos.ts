import api from "./api";

import {
  NxosBgpNeighbor,
  NxosDevice,
  NxosDeviceCreate,
  NxosDevicePage,
  NxosInterface,
  NxosModule,
  NxosNeighbor,
  NxosSummary,
  NxosSyncResult,
  NxosTopology,
  NxosVrf
} from "@/types";

interface FetchNxosDevicesOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchNxosDevices = async (options: FetchNxosDevicesOptions = {}): Promise<NxosDevicePage> => {
  const params: Record<string, string> = {};
  if (options.search) params.search = options.search;
  if (typeof options.page === "number") params.page = String(options.page);
  if (typeof options.pageSize === "number") params.page_size = String(options.pageSize);
  const { data } = await api.get<NxosDevicePage>("/nxos/devices", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchNxosSummary = async (): Promise<NxosSummary> => {
  const { data } = await api.get<NxosSummary>("/nxos/summary");
  return data;
};

export const fetchNxosTopology = async (): Promise<NxosTopology> => {
  const { data } = await api.get<NxosTopology>("/nxos/topology");
  return data;
};

export const fetchNxosDevice = async (deviceId: string): Promise<NxosDevice> => {
  const { data } = await api.get<NxosDevice>(`/nxos/devices/${deviceId}`);
  return data;
};

export const fetchNxosDeviceInterfaces = async (deviceId: string): Promise<NxosInterface[]> => {
  const { data } = await api.get<NxosInterface[]>(`/nxos/devices/${deviceId}/interfaces`);
  return data;
};

export const fetchNxosDeviceModules = async (deviceId: string): Promise<NxosModule[]> => {
  const { data } = await api.get<NxosModule[]>(`/nxos/devices/${deviceId}/modules`);
  return data;
};

export const fetchNxosDeviceVrfs = async (deviceId: string): Promise<NxosVrf[]> => {
  const { data } = await api.get<NxosVrf[]>(`/nxos/devices/${deviceId}/vrfs`);
  return data;
};

export const fetchNxosDeviceNeighbors = async (deviceId: string, protocol?: string): Promise<NxosNeighbor[]> => {
  const { data } = await api.get<NxosNeighbor[]>(`/nxos/devices/${deviceId}/neighbors`, {
    params: protocol ? { protocol } : undefined
  });
  return data;
};

export const fetchNxosDeviceBgp = async (deviceId: string): Promise<NxosBgpNeighbor[]> => {
  const { data } = await api.get<NxosBgpNeighbor[]>(`/nxos/devices/${deviceId}/bgp`);
  return data;
};

export const createNxosDevice = async (payload: NxosDeviceCreate): Promise<NxosDevice> => {
  const { data } = await api.post<NxosDevice>("/nxos/devices", payload);
  return data;
};

export const deleteNxosDevice = async (deviceId: string): Promise<void> => {
  await api.delete(`/nxos/devices/${deviceId}`);
};

export const syncNxosDevice = async (deviceId: string): Promise<NxosSyncResult> => {
  const { data } = await api.post<NxosSyncResult>(`/nxos/devices/${deviceId}/sync`);
  return data;
};
