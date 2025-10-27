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
