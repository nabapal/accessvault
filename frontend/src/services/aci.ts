import api from "./api";

import {
  AciFabricEndpointPage,
  AciFabricVlanPage,
  AciFreePortReport,
  AciFabricNodeDetail,
  AciFabricNodeInterface,
  AciFabricNodePage,
  AciFabricSummary,
  AciFabricSummaryDetails,
  AciNodeRole
} from "@/types";

interface FetchAciFabricNodesOptions {
  role?: AciNodeRole;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchAciFabricNodes = async (options: FetchAciFabricNodesOptions = {}): Promise<AciFabricNodePage> => {
  const params: Record<string, string> = {};
  if (options.role) {
    params.role = options.role;
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
  const { data } = await api.get<AciFabricNodePage>("/aci/fabric/nodes", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

interface FetchAciFabricEndpointsOptions {
  fabric?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchAciFabricEndpoints = async (
  options: FetchAciFabricEndpointsOptions = {}
): Promise<AciFabricEndpointPage> => {
  const params: Record<string, string> = {};
  if (options.fabric) {
    params.fabric = options.fabric;
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
  const { data } = await api.get<AciFabricEndpointPage>("/aci/fabric/endpoints", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchAciFabricSummary = async (): Promise<AciFabricSummary> => {
  const { data } = await api.get<AciFabricSummary>("/aci/fabric/summary");
  return data;
};

interface FetchAciFabricSummaryDetailsOptions {
  fabric?: string;
  roles?: AciNodeRole[];
  models?: string[];
  versions?: string[];
  fabricStates?: string[];
}

export const fetchAciFabricSummaryDetails = async (
  options: FetchAciFabricSummaryDetailsOptions = {}
): Promise<AciFabricSummaryDetails> => {
  const params: Record<string, string | string[]> = {};
  if (options.fabric) {
    params.fabric = options.fabric;
  }
  if (options.roles && options.roles.length > 0) {
    params.roles = options.roles;
  }
  if (options.models && options.models.length > 0) {
    params.models = options.models;
  }
  if (options.versions && options.versions.length > 0) {
    params.versions = options.versions;
  }
  if (options.fabricStates && options.fabricStates.length > 0) {
    params.fabric_states = options.fabricStates;
  }

  const { data } = await api.get<AciFabricSummaryDetails>("/aci/fabric/summary/details", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

interface FetchAciFabricVlansOptions {
  fabric?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchAciFabricVlans = async (
  options: FetchAciFabricVlansOptions = {}
): Promise<AciFabricVlanPage> => {
  const params: Record<string, string> = {};
  if (options.fabric) {
    params.fabric = options.fabric;
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
  const { data } = await api.get<AciFabricVlanPage>("/aci/fabric/vlans", {
    params: Object.keys(params).length ? params : undefined
  });
  return data;
};

export const fetchAciFreePorts = async (): Promise<AciFreePortReport> => {
  const { data } = await api.get<AciFreePortReport>("/aci/fabric/free-ports");
  return data;
};

export const fetchAciFabricNodeDetail = async (nodeId: string): Promise<AciFabricNodeDetail> => {
  const { data } = await api.get<AciFabricNodeDetail>(`/aci/fabric/nodes/${nodeId}/detail`);
  return data;
};

export const fetchAciFabricNodeInterfaces = async (nodeId: string): Promise<AciFabricNodeInterface[]> => {
  const { data } = await api.get<AciFabricNodeInterface[]>(`/aci/fabric/nodes/${nodeId}/interfaces`);
  return data;
};
