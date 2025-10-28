export type Role = "admin" | "user";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
}

export type AccessType = "gui" | "cli" | "both";
export interface SystemCredential {
  id: string;
  user_id: string;
  login_endpoint: string;
  access_scope: AccessType;
}

export interface System {
  id: string;
  group_id: string;
  name: string;
  ip_address: string;
  credentials: SystemCredential[];
}

export interface SystemCredentialSecret extends SystemCredential {
  password: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description?: string | null;
}

export interface GroupDetail extends GroupSummary {
  systems: System[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export type InventorySourceType = "esxi" | "vcenter";

export type InventoryEndpointStatus = "never" | "ok" | "error";

export type InventoryHostConnectionState = "connected" | "disconnected" | "maintenance";

export type InventoryPowerState = "powered_on" | "powered_off" | "suspended" | "unknown";

export interface InventoryEndpoint {
  id: string;
  name: string;
  address: string;
  port: number;
  source_type: InventorySourceType;
  username: string;
  verify_ssl: boolean;
  poll_interval_seconds: number;
  description?: string | null;
  tags: string[];
  last_polled_at?: string | null;
  last_poll_status: InventoryEndpointStatus;
  last_error_message?: string | null;
  has_credentials: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryHost {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  name: string;
  cluster?: string | null;
  hardware_model?: string | null;
  connection_state: InventoryHostConnectionState;
  power_state: InventoryPowerState;
  cpu_cores?: number | null;
  cpu_usage_mhz?: number | null;
  memory_total_mb?: number | null;
  memory_usage_mb?: number | null;
  datastore_total_gb?: number | null;
  datastore_free_gb?: number | null;
  uptime_seconds?: number | null;
  last_seen_at?: string | null;
  updated_at: string;
}

export interface InventoryVirtualMachine {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  host_id?: string | null;
  host_name?: string | null;
  name: string;
  guest_os?: string | null;
  power_state: InventoryPowerState;
  cpu_count?: number | null;
  memory_mb?: number | null;
  cpu_usage_mhz?: number | null;
  memory_usage_mb?: number | null;
  provisioned_storage_gb?: number | null;
  used_storage_gb?: number | null;
  ip_address?: string | null;
  datastores: string[];
  networks: string[];
  tools_status?: string | null;
  last_seen_at?: string | null;
  updated_at: string;
}

export interface InventoryDatastore {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  name: string;
  type?: string | null;
  capacity_gb?: number | null;
  free_gb?: number | null;
  last_seen_at?: string | null;
  updated_at: string;
}

export interface InventoryNetwork {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  name: string;
  last_seen_at?: string | null;
  updated_at: string;
}

export interface InventoryEndpointValidationResult {
  reachable: boolean;
  host_count: number;
  virtual_machine_count: number;
  datastore_count: number;
  network_count: number;
  message?: string | null;
  collected_at?: string | null;
}

export interface InventoryEndpointSyncResponse {
  endpoint: InventoryEndpoint;
  summary: InventoryEndpointValidationResult;
}

export type AciNodeRole = "leaf" | "spine" | "controller" | "unspecified";

export interface AciFabricNode {
  id: string;
  distinguished_name: string;
  name: string;
  role: AciNodeRole;
  node_id: string;
  address?: string | null;
  serial?: string | null;
  model?: string | null;
  version?: string | null;
  vendor?: string | null;
  node_type?: string | null;
  apic_type?: string | null;
  fabric_state?: string | null;
  admin_state?: string | null;
  delayed_heartbeat: boolean;
  pod?: string | null;
  fabric_job_id?: string | null;
  fabric_name?: string | null;
  fabric_ip?: string | null;
  last_state_change_at?: string | null;
  last_modified_at?: string | null;
  raw_attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AciFabricNodePage {
  items: AciFabricNode[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface AciFabricSummaryFabric {
  fabric_job_id?: string | null;
  fabric_name: string;
  fabric_ip?: string | null;
  total_nodes: number;
  delayed_heartbeat: number;
  by_role: Record<string, number>;
  by_model: Record<string, number>;
  by_version: Record<string, number>;
  by_fabric_state: Record<string, number>;
  last_polled_at?: string | null;
}

export interface AciFabricSummaryDetails {
  total_nodes: number;
  total_fabrics: number;
  fabrics: AciFabricSummaryFabric[];
  available_roles: string[];
  available_models: string[];
  available_versions: string[];
  available_fabric_states: string[];
}

export interface AciFabricSummary {
  total: number;
  leaf_count: number;
  spine_count: number;
  controller_count: number;
  unspecified_count: number;
  delayed_heartbeat: number;
  by_fabric_state: Record<string, number>;
  by_version: Record<string, number>;
}

export type TelcoFabricType = "aci" | "nxos";

export type TelcoOnboardingStatus = "pending" | "validating" | "ready" | "failed";

export interface TelcoOnboardingJob {
  id: string;
  name: string;
  fabric_type: TelcoFabricType;
  target_host: string;
  port: number;
  username?: string | null;
  verify_ssl: boolean;
  description?: string | null;
  connection_params: Record<string, unknown>;
  poll_interval_seconds: number;
  status: TelcoOnboardingStatus;
  has_credentials: boolean;
  last_error?: string | null;
  last_snapshot?: Record<string, unknown> | null;
  last_polled_at?: string | null;
  last_validation_started_at?: string | null;
  last_validation_completed_at?: string | null;
  created_at: string;
  updated_at: string;
}
