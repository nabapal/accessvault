import api from "./api";

import {
  PbrBlastRadius,
  PbrFabric,
  PbrFlowLookupResult,
  PbrHealthHistory,
  PbrServiceDetail,
  PbrServicePage,
  PbrServiceState
} from "@/types";

export const fetchPbrFabrics = async (): Promise<PbrFabric[]> => {
  const { data } = await api.get<PbrFabric[]>("/pbr/fabrics");
  return data;
};

interface FetchPbrServicesOptions {
  search?: string;
  state?: PbrServiceState;
  sort?: "health" | "name" | "state";
  page?: number;
  pageSize?: number;
}

export const fetchPbrServices = async (
  fabricId: string,
  options: FetchPbrServicesOptions = {}
): Promise<PbrServicePage> => {
  const params: Record<string, string> = {};
  if (options.search) {
    params.search = options.search;
  }
  if (options.state) {
    params.state = options.state;
  }
  if (options.sort) {
    params.sort = options.sort;
  }
  if (typeof options.page === "number") {
    params.page = String(options.page);
  }
  if (typeof options.pageSize === "number") {
    params.page_size = String(options.pageSize);
  }
  const { data } = await api.get<PbrServicePage>(`/pbr/fabrics/${fabricId}/services`, {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchPbrServiceDetail = async (serviceId: string): Promise<PbrServiceDetail> => {
  const { data } = await api.get<PbrServiceDetail>(`/pbr/services/${serviceId}`);
  return data;
};

export const fetchPbrBlastRadius = async (serviceId: string): Promise<PbrBlastRadius> => {
  const { data } = await api.get<PbrBlastRadius>(`/pbr/services/${serviceId}/blast-radius`);
  return data;
};

export const fetchPbrHealthHistory = async (
  serviceId: string,
  windowHours = 24
): Promise<PbrHealthHistory> => {
  const { data } = await api.get<PbrHealthHistory>(`/pbr/services/${serviceId}/health-history`, {
    params: { window_hours: String(windowHours) }
  });
  return data;
};

export const pbrFlowLookup = async (
  fabricId: string,
  source: string,
  destination: string
): Promise<PbrFlowLookupResult> => {
  const { data } = await api.post<PbrFlowLookupResult>(`/pbr/fabrics/${fabricId}/flow-lookup`, {
    source,
    destination
  });
  return data;
};
