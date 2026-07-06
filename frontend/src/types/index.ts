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
  serial?: string | null;
  cluster?: string | null;
  hardware_model?: string | null;
  site_name?: string | null;
  rack_location?: string | null;
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
  site_name?: string | null;
  rack_location?: string | null;
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

export interface AciFabricEndpoint {
  id: string;
  fabric_job_id?: string | null;
  fabric_name?: string | null;
  fabric_ip?: string | null;
  distinguished_name: string;
  mac?: string | null;
  ip_addresses: string[];
  tenant?: string | null;
  app_profile?: string | null;
  epg?: string | null;
  encap?: string | null;
  bridge_domain?: string | null;
  vrf?: string | null;
  pod?: string | null;
  nodes: string[];
  interface?: string | null;
  path_dn?: string | null;
  learning_source?: string | null;
  last_modified_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AciFabricEndpointPage {
  items: AciFabricEndpoint[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface AciFabricVlan {
  id: string;
  fabric_job_id?: string | null;
  fabric_name?: string | null;
  fabric_ip?: string | null;
  vlan_id?: number | null;
  encap: string;
  fab_encap?: string | null;
  epg?: string | null;
  tenant?: string | null;
  app_profile?: string | null;
  bridge_domain?: string | null;
  binding_type?: string | null;
  l3out?: string | null;
  vrf?: string | null;
  pc_tag?: string | null;
  mode?: string | null;
  admin_state?: string | null;
  oper_state?: string | null;
  node_count: number;
  nodes: string[];
  created_at: string;
  updated_at: string;
}

export interface AciFabricVlanPage {
  items: AciFabricVlan[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface AciFreePortNode {
  node_uuid: string;
  fabric_job_id?: string | null;
  fabric_name?: string | null;
  fabric_ip?: string | null;
  node_id: string;
  name: string;
  model?: string | null;
  role: string;
  pod?: string | null;
  free: number;
  excluded: number;
  sfp_missing: number;
  free_ports: string[];
}

export interface AciFreePortFabric {
  fabric_job_id?: string | null;
  fabric_name: string;
  fabric_ip?: string | null;
  free: number;
  excluded: number;
  sfp_missing: number;
  nodes_with_free: number;
  total_nodes: number;
}

export interface AciFreePortReport {
  fabrics: AciFreePortFabric[];
  nodes: AciFreePortNode[];
  total_free: number;
  total_excluded: number;
  total_sfp_missing: number;
  total_fabrics: number;
  total_nodes: number;
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

export interface AciFabricNodeHealthSample {
  window: string;
  health_last?: number | null;
  health_avg?: number | null;
  health_max?: number | null;
  health_min?: number | null;
  sample_start?: string | null;
  sample_end?: string | null;
}

export interface AciFabricNodeCpuStats {
  usage_pct?: number | null;
  idle_pct?: number | null;
  user_pct?: number | null;
  kernel_pct?: number | null;
  sample_start?: string | null;
  sample_end?: string | null;
}

export interface AciFabricNodeMemoryStats {
  total_kb?: number | null;
  used_kb?: number | null;
  free_kb?: number | null;
  usage_pct?: number | null;
  sample_start?: string | null;
  sample_end?: string | null;
}

export interface AciFabricNodeResources {
  cpu?: AciFabricNodeCpuStats | null;
  memory?: AciFabricNodeMemoryStats | null;
}

export interface AciFabricNodeTempSensor {
  name: string;
  value_celsius?: number | null;
  normalized_value?: number | null;
  distinguished_name?: string | null;
}

export interface AciFabricNodeFan {
  name: string;
  direction?: string | null;
  model?: string | null;
  vendor?: string | null;
  status?: string | null;
  distinguished_name?: string | null;
}

export interface AciFabricNodeEnvironment {
  temperatures: AciFabricNodeTempSensor[];
  fans: AciFabricNodeFan[];
  power_supplies: Record<string, unknown>[];
}

export interface AciFabricNodeFirmware {
  version?: string | null;
  description?: string | null;
  pe_version?: string | null;
  bios_version?: string | null;
  bios_timestamp?: string | null;
  kickstart_image?: string | null;
  system_image?: string | null;
  last_boot?: string | null;
}

export interface AciFabricNodePortChannelMember {
  name: string;
  distinguished_name?: string | null;
}

export interface AciFabricNodePortChannel {
  port_channel_id: string;
  name?: string | null;
  admin_state?: string | null;
  oper_state?: string | null;
  usage?: string | null;
  speed?: string | null;
  active_ports?: number | null;
  members: AciFabricNodePortChannelMember[];
}

export interface AciFabricNodeTransceiver {
  product_id?: string | null;
  serial?: string | null;
  type?: string | null;
  vendor?: string | null;
  state?: string | null;
  is_present?: string | null;
}

export interface AciFabricNodeGeneral {
  fabric_domain?: string | null;
  fabric_id?: string | null;
  pod_id?: string | null;
  address?: string | null;
  inband_address?: string | null;
  inband_gateway?: string | null;
  oob_address?: string | null;
  oob_gateway?: string | null;
  serial?: string | null;
  system_name?: string | null;
  uptime?: string | null;
  last_reboot_at?: string | null;
  last_reset_reason?: string | null;
  current_time?: string | null;
  mode?: string | null;
}

export interface AciFabricNodeDetail {
  node: AciFabricNode;
  collected_at?: string | null;
  general: AciFabricNodeGeneral;
  health: { samples: AciFabricNodeHealthSample[] };
  resources: AciFabricNodeResources;
  environment: AciFabricNodeEnvironment;
  firmware: AciFabricNodeFirmware | null;
  port_channels: AciFabricNodePortChannel[];
}

export interface AciInterfaceBinding {
  name: string;
  encap?: string | null;
  mode?: string | null;
  immediacy?: string | null;
  path?: string | null;
}

export interface AciFabricNodeInterface {
  id: string;
  node_id: string;
  name: string;
  distinguished_name: string;
  description?: string | null;
  admin_state?: string | null;
  oper_state?: string | null;
  oper_speed?: string | null;
  usage?: string | null;
  last_link_change_at?: string | null;
  mtu?: number | null;
  fec_mode?: string | null;
  duplex?: string | null;
  mac?: string | null;
  port_type?: string | null;
  bundle_id?: string | null;
  port_channel_id?: string | null;
  port_channel_name?: string | null;
  vlan_list?: string | null;
  epg_bindings: AciInterfaceBinding[];
  l3out_bindings: AciInterfaceBinding[];
  attributes: Record<string, unknown>;
  transceiver: AciFabricNodeTransceiver;
  stats: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

export type IpMplsPlatform = "iosxe" | "iosxr" | "unknown";
export type IpMplsDeviceStatus = "pending" | "ok" | "error";

export interface IpMplsDevice {
  id: string;
  name: string;
  hostname?: string | null;
  mgmt_ip: string;
  port: number;
  platform: IpMplsPlatform;
  role?: string | null;
  model?: string | null;
  serial?: string | null;
  os_version?: string | null;
  uptime_seconds?: number | null;
  uptime_text?: string | null;
  description?: string | null;
  site_name?: string | null;
  rack_location?: string | null;
  poll_interval_seconds: number;
  status: IpMplsDeviceStatus;
  last_polled_at?: string | null;
  last_error?: string | null;
  username?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IpMplsDevicePage {
  items: IpMplsDevice[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface IpMplsInterface {
  id: string;
  device_id: string;
  name: string;
  description?: string | null;
  admin_state?: string | null;
  oper_state?: string | null;
  ip_address?: string | null;
  prefix_len?: number | null;
  vrf?: string | null;
  speed?: string | null;
  mtu?: number | null;
  mac?: string | null;
  mpls_enabled?: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface IpMplsModule {
  id: string;
  device_id: string;
  name?: string | null;
  description?: string | null;
  pid?: string | null;
  vid?: string | null;
  serial?: string | null;
}

export interface IpMplsSummary {
  total: number;
  total_interfaces: number;
  total_vrfs: number;
  unique_vrfs: number;
  total_neighbors: number;
  mpls_interfaces: number;
  interfaces_up: number;
  error_devices: number;
  stale_devices: number;
  by_platform: Record<string, number>;
  by_status: Record<string, number>;
  by_role: Record<string, number>;
  by_location: Record<string, number>;
  by_model: Record<string, number>;
  by_os: Record<string, number>;
  by_neighbor_protocol: Record<string, number>;
}

export interface IpMplsSyncResult {
  success: boolean;
  message?: string | null;
  interfaces: number;
  modules: number;
  device: IpMplsDevice;
}

export interface IpMplsDeviceCreate {
  name: string;
  mgmt_ip: string;
  port?: number;
  platform?: IpMplsPlatform;
  role?: string;
  description?: string;
  poll_interval_seconds?: number;
  username: string;
  password: string;
  enable?: string;
}

export interface IpMplsVrf {
  id: string;
  device_id: string;
  name: string;
  rd?: string | null;
  rt_import: string[];
  rt_export: string[];
  interfaces: string[];
  protocols?: string | null;
  description?: string | null;
}

export interface IpMplsNeighbor {
  id: string;
  device_id: string;
  protocol: string;
  neighbor_id?: string | null;
  address?: string | null;
  interface?: string | null;
  state?: string | null;
  uptime?: string | null;
  vrf?: string | null;
  attributes: Record<string, unknown>;
}

export interface IpMplsTopologyNode {
  id: string;
  name: string;
  kind: string;
  role?: string | null;
  platform?: string | null;
  site?: string | null;
  device_id?: string | null;
}

export interface IpMplsTopologyLink {
  source: string;
  target: string;
  protocol: string;
  interfaces: string[];
  count: number;
  endpoint_interfaces?: Record<string, string[]>;
}

export interface IpMplsTopology {
  nodes: IpMplsTopologyNode[];
  links: IpMplsTopologyLink[];
  total_nodes: number;
  total_links: number;
  protocol: string;
}

// ---------------------------------------------------------------------------
// NX-OS (Nexus) inventory
// ---------------------------------------------------------------------------
export type NxosPlatform = "nxos" | "unknown";
export type NxosDeviceStatus = "pending" | "ok" | "error";

export interface NxosDevice {
  id: string;
  name: string;
  hostname?: string | null;
  mgmt_ip: string;
  port: number;
  platform: NxosPlatform;
  role?: string | null;
  model?: string | null;
  serial?: string | null;
  os_version?: string | null;
  uptime_seconds?: number | null;
  uptime_text?: string | null;
  description?: string | null;
  site_name?: string | null;
  rack_location?: string | null;
  poll_interval_seconds: number;
  status: NxosDeviceStatus;
  last_polled_at?: string | null;
  last_error?: string | null;
  username?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NxosDevicePage {
  items: NxosDevice[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface NxosInterface {
  id: string;
  device_id: string;
  name: string;
  description?: string | null;
  admin_state?: string | null;
  oper_state?: string | null;
  ip_address?: string | null;
  prefix_len?: number | null;
  vrf?: string | null;
  speed?: string | null;
  mtu?: number | null;
  mac?: string | null;
  mode?: string | null;
  access_vlan?: string | null;
  trunk_vlans?: string | null;
  port_channel?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NxosModule {
  id: string;
  device_id: string;
  name?: string | null;
  description?: string | null;
  pid?: string | null;
  vid?: string | null;
  serial?: string | null;
  slot?: string | null;
}

export interface NxosVrf {
  id: string;
  device_id: string;
  name: string;
  rd?: string | null;
  state?: string | null;
  interfaces: string[];
  attributes: Record<string, unknown>;
}

export interface NxosNeighbor {
  id: string;
  device_id: string;
  protocol: string;
  local_interface?: string | null;
  remote_device?: string | null;
  remote_interface?: string | null;
  remote_platform?: string | null;
  remote_mgmt_ip?: string | null;
  attributes: Record<string, unknown>;
}

export interface NxosBgpNeighbor {
  id: string;
  device_id: string;
  vrf?: string | null;
  address_family?: string | null;
  neighbor_ip: string;
  remote_as?: string | null;
  local_as?: string | null;
  state?: string | null;
  prefixes_received?: number | null;
  prefixes_sent?: number | null;
  uptime?: string | null;
  description?: string | null;
  attributes: Record<string, unknown>;
}

export interface NxosDeviceCreate {
  name: string;
  mgmt_ip: string;
  port?: number;
  platform?: NxosPlatform;
  role?: string;
  description?: string;
  poll_interval_seconds?: number;
  username: string;
  password: string;
  enable?: string;
}

export interface NxosSyncResult {
  success: boolean;
  message?: string | null;
  interfaces: number;
  modules: number;
  vrfs: number;
  neighbors: number;
  bgp_neighbors: number;
  device: NxosDevice;
}

export interface NxosTopologyNode {
  id: string;
  name: string;
  kind: string;
  role?: string | null;
  platform?: string | null;
  site?: string | null;
  device_id?: string | null;
}

export interface NxosTopologyLink {
  source: string;
  target: string;
  interfaces: string[];
  count: number;
  discovered_by: string[];
  endpoint_interfaces?: Record<string, string[]>;
}

export interface NxosTopology {
  nodes: NxosTopologyNode[];
  links: NxosTopologyLink[];
  total_nodes: number;
  total_links: number;
}

export interface NxosSummary {
  total: number;
  total_interfaces: number;
  interfaces_up: number;
  total_vrfs: number;
  unique_vrfs: number;
  total_neighbors: number;
  total_bgp_neighbors: number;
  error_devices: number;
  stale_devices: number;
  by_platform: Record<string, number>;
  by_status: Record<string, number>;
  by_role: Record<string, number>;
  by_location: Record<string, number>;
  by_model: Record<string, number>;
  by_os: Record<string, number>;
  by_neighbor_protocol: Record<string, number>;
}
