import api from "./api";

import {
  InventoryDatastore,
  InventoryEndpoint,
  InventoryEndpointSyncResponse,
  InventoryEndpointValidationResult,
  InventoryHost,
  InventoryNetwork,
  InventorySourceType,
  InventoryVirtualMachine
} from "@/types";

export interface CreateInventoryEndpointPayload {
  name: string;
  address: string;
  port?: number;
  source_type?: InventorySourceType;
  username: string;
  password: string;
  verify_ssl?: boolean;
  poll_interval_seconds?: number;
  description?: string | null;
  tags?: string[];
}

export interface UpdateInventoryEndpointPayload extends Partial<CreateInventoryEndpointPayload> {
  password?: string;
}

export const fetchInventoryEndpoints = async (): Promise<InventoryEndpoint[]> => {
  const { data } = await api.get<InventoryEndpoint[]>("/inventory/endpoints");
  return data;
};

export const createInventoryEndpoint = async (
  payload: CreateInventoryEndpointPayload
): Promise<InventoryEndpoint> => {
  const { data } = await api.post<InventoryEndpoint>("/inventory/endpoints", payload);
  return data;
};

export const updateInventoryEndpoint = async (
  id: string,
  payload: UpdateInventoryEndpointPayload
): Promise<InventoryEndpoint> => {
  const { data } = await api.patch<InventoryEndpoint>(`/inventory/endpoints/${id}`, payload);
  return data;
};

export const deleteInventoryEndpoint = async (id: string): Promise<void> => {
  await api.delete(`/inventory/endpoints/${id}`);
};

export const fetchInventoryHosts = async (endpointId?: string): Promise<InventoryHost[]> => {
  const { data } = await api.get<InventoryHost[]>("/inventory/hosts", {
    params: endpointId ? { endpoint_id: endpointId } : undefined
  });
  return data;
};

export const fetchInventoryVirtualMachines = async (
  options: { endpointId?: string; hostId?: string } = {}
): Promise<InventoryVirtualMachine[]> => {
  const params: Record<string, string> = {};
  if (options.endpointId) {
    params.endpoint_id = options.endpointId;
  }
  if (options.hostId) {
    params.host_id = options.hostId;
  }
  const { data } = await api.get<InventoryVirtualMachine[]>("/inventory/virtual-machines", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchInventoryDatastores = async (endpointId?: string): Promise<InventoryDatastore[]> => {
  const { data } = await api.get<InventoryDatastore[]>("/inventory/datastores", {
    params: endpointId ? { endpoint_id: endpointId } : undefined
  });
  return data;
};

export const fetchInventoryNetworks = async (endpointId?: string): Promise<InventoryNetwork[]> => {
  const { data } = await api.get<InventoryNetwork[]>("/inventory/networks", {
    params: endpointId ? { endpoint_id: endpointId } : undefined
  });
  return data;
};

export const validateInventoryEndpoint = async (
  payload: CreateInventoryEndpointPayload
): Promise<InventoryEndpointValidationResult> => {
  const { data } = await api.post<InventoryEndpointValidationResult>(
    "/inventory/endpoints/validate",
    payload
  );
  return data;
};

export const testInventoryEndpoint = async (id: string): Promise<InventoryEndpointValidationResult> => {
  const { data } = await api.post<InventoryEndpointValidationResult>(`/inventory/endpoints/${id}/test`, {});
  return data;
};

export const syncInventoryEndpoint = async (id: string): Promise<InventoryEndpointSyncResponse> => {
  const { data } = await api.post<InventoryEndpointSyncResponse>(`/inventory/endpoints/${id}/sync`, {});
  return data;
};