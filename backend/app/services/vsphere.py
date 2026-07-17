import ssl
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional, Set

from pyVim.connect import Disconnect, SmartConnect


@dataclass
class VsphereHostPortgroup:
    name: str
    switch_name: Optional[str]
    switch_kind: Optional[str]
    uplinks: List[str]
    vlan_id: Optional[str]


@dataclass
class VsphereHostNic:
    device: str
    mac: Optional[str]
    speed_mb: Optional[int]
    neighbor_protocol: Optional[str]
    remote_device: Optional[str]
    remote_port: Optional[str]
    remote_platform: Optional[str]
    remote_mgmt: Optional[str]
    attributes: dict


@dataclass
class VsphereHost:
    name: str
    cluster: Optional[str]
    hardware_model: Optional[str]
    serial: Optional[str]
    connection_state: str
    power_state: str
    cpu_cores: Optional[int]
    cpu_usage_mhz: Optional[int]
    memory_total_mb: Optional[int]
    memory_usage_mb: Optional[int]
    uptime_seconds: Optional[int]
    datastore_total_gb: Optional[float]
    datastore_free_gb: Optional[float]
    vendor: Optional[str] = None
    cpu_model: Optional[str] = None
    bios_version: Optional[str] = None
    esxi_version: Optional[str] = None
    management_ip: Optional[str] = None
    nics: List["VsphereHostNic"] = field(default_factory=list)
    portgroups: List["VsphereHostPortgroup"] = field(default_factory=list)


@dataclass
class VsphereVirtualMachine:
    name: str
    host_name: Optional[str]
    guest_os: Optional[str]
    power_state: str
    ip_address: Optional[str]
    cpu_count: Optional[int]
    memory_mb: Optional[int]
    cpu_usage_mhz: Optional[int]
    memory_usage_mb: Optional[int]
    used_storage_gb: Optional[float]
    provisioned_storage_gb: Optional[float]
    datastores: List[str]
    networks: List[str]
    tools_status: Optional[str]


@dataclass
class VsphereDatastore:
    name: str
    type: Optional[str]
    capacity_gb: Optional[float]
    free_gb: Optional[float]


@dataclass
class VsphereNetwork:
    name: str


@dataclass
class VsphereSnapshot:
    collected_at: datetime
    hosts: List[VsphereHost]
    virtual_machines: List[VsphereVirtualMachine]
    datastores: List[VsphereDatastore]
    networks: List[VsphereNetwork]


def _bytes_to_gb(value: Optional[int]) -> Optional[float]:
    if not value:
        return None
    return round(value / (1024 ** 3), 2)


def _lldp_params(lldp) -> dict:
    out = {}
    for kv in getattr(lldp, "parameter", []) or []:
        key = getattr(kv, "key", None)
        if key is not None:
            out[str(key)] = str(getattr(kv, "value", None))
    return out


def _host_nics_and_mgmt(esxi_host, host_net):
    """Build per-uplink NIC + LLDP/CDP neighbor rows (one per protocol) and the mgmt vmk IP."""
    nics: List[VsphereHostNic] = []
    mgmt_ip = None
    if host_net is None:
        return nics, mgmt_ip

    # management vmk IP: prefer a vmk on a "Management" portgroup, else the first vmk.
    for vnic in getattr(host_net, "vnic", []) or []:
        ip = getattr(getattr(vnic, "spec", None), "ip", None)
        addr = getattr(ip, "ipAddress", None)
        if not addr:
            continue
        if mgmt_ip is None:
            mgmt_ip = addr
        if "management" in str(getattr(vnic, "portgroup", "")).lower():
            mgmt_ip = addr
            break

    pnics = {p.device: p for p in (getattr(host_net, "pnic", []) or [])}
    hints = []
    try:
        hints = esxi_host.configManager.networkSystem.QueryNetworkHint() or []
    except Exception:  # pragma: no cover - hint may be unavailable
        hints = []

    for hint in hints:
        dev = getattr(hint, "device", None)
        if not dev:
            continue
        pnic = pnics.get(dev)
        mac = getattr(pnic, "mac", None) if pnic else None
        speed = getattr(getattr(pnic, "linkSpeed", None), "speedMb", None) if pnic else None
        added = False
        lldp = getattr(hint, "lldpInfo", None)
        if lldp is not None:
            params = _lldp_params(lldp)
            nics.append(
                VsphereHostNic(
                    device=dev, mac=mac, speed_mb=speed, neighbor_protocol="lldp",
                    remote_device=params.get("System Name") or getattr(lldp, "chassisId", None),
                    remote_port=getattr(lldp, "portId", None) or params.get("Port Description"),
                    remote_platform=params.get("System Description"),
                    remote_mgmt=params.get("Management Address"),
                    attributes={"chassis_id": getattr(lldp, "chassisId", None), "params": params},
                )
            )
            added = True
        cdp = getattr(hint, "connectedSwitchPort", None)
        if cdp is not None:
            nics.append(
                VsphereHostNic(
                    device=dev, mac=mac, speed_mb=speed, neighbor_protocol="cdp",
                    remote_device=getattr(cdp, "devId", None),
                    remote_port=getattr(cdp, "portId", None),
                    remote_platform=getattr(cdp, "hardwarePlatform", None),
                    remote_mgmt=getattr(cdp, "address", None),
                    attributes={"vlan": getattr(cdp, "vlan", None)},
                )
            )
            added = True
        if not added:
            nics.append(
                VsphereHostNic(
                    device=dev, mac=mac, speed_mb=speed, neighbor_protocol=None,
                    remote_device=None, remote_port=None, remote_platform=None, remote_mgmt=None,
                    attributes={},
                )
            )
    return nics, mgmt_ip


def _host_portgroups(host_net) -> List[VsphereHostPortgroup]:
    """Map each portgroup to its vSwitch/vDS uplink vmnics (VM connectivity path)."""
    result: List[VsphereHostPortgroup] = []
    if host_net is None:
        return result
    pnic_by_key = {p.key: p.device for p in (getattr(host_net, "pnic", []) or [])}
    # standard vSwitch name -> uplink devices
    vsw_uplinks = {
        vs.name: [pnic_by_key.get(k, k) for k in (getattr(vs, "pnic", []) or [])]
        for vs in (getattr(host_net, "vswitch", []) or [])
    }
    # vDS (proxySwitch) name -> uplink devices
    dvs_uplinks = {
        ps.dvsName: [pnic_by_key.get(k, k) for k in (getattr(ps, "pnic", []) or [])]
        for ps in (getattr(host_net, "proxySwitch", []) or [])
    }
    # standard portgroups
    for pg in getattr(host_net, "portgroup", []) or []:
        spec = getattr(pg, "spec", None)
        name = getattr(spec, "name", None)
        vsw = getattr(spec, "vswitchName", None)
        if not name:
            continue
        vlan = getattr(spec, "vlanId", None)
        result.append(
            VsphereHostPortgroup(
                name=name, switch_name=vsw, switch_kind="standard",
                uplinks=vsw_uplinks.get(vsw, []), vlan_id=str(vlan) if vlan not in (None, 0) else None,
            )
        )
    # vDS portgroups run through the proxySwitch uplinks; expose per-DVS entry so VMs on a
    # distributed portgroup still resolve to uplinks (portgroup name match handled at join time).
    for dvs_name, uplinks in dvs_uplinks.items():
        result.append(
            VsphereHostPortgroup(
                name=f"[dvs] {dvs_name}", switch_name=dvs_name, switch_kind="dvs",
                uplinks=uplinks, vlan_id=None,
            )
        )
    return result


def collect_inventory(
    address: str,
    port: int,
    username: str,
    password: str,
    verify_ssl: bool,
) -> VsphereSnapshot:
    ssl_context = None
    if not verify_ssl:
        ssl_context = ssl._create_unverified_context()

    si = SmartConnect(host=address, user=username, pwd=password, port=port, sslContext=ssl_context)
    try:
        content = si.RetrieveContent()
        # apiType is "HostAgent" for a direct ESXi connection, "VirtualCenter" for vCenter.
        # A direct ESXi host often reports config.name as "localhost.localdomain"; fall back to
        # the address we connected to (the host's IP) so the UI shows a meaningful identifier.
        api_type = getattr(getattr(content, "about", None), "apiType", None)
        is_direct_esxi = api_type == "HostAgent"

        def _resolve_host_name(config_name: Optional[str]) -> str:
            if is_direct_esxi and (not config_name or str(config_name).strip().lower() in ("localhost.localdomain", "localhost")):
                return address
            return config_name or address

        hosts: List[VsphereHost] = []
        virtual_machines: List[VsphereVirtualMachine] = []
        datastore_map: dict[str, VsphereDatastore] = {}
        network_names: Set[str] = set()

        for datacenter in content.rootFolder.childEntity:
            host_folder = getattr(datacenter, "hostFolder", None)
            if host_folder is None:
                continue
            for compute_resource in host_folder.childEntity:
                cluster_name = getattr(compute_resource, "name", None)
                for esxi_host in getattr(compute_resource, "host", []) or []:
                    summary = esxi_host.summary
                    hardware = summary.hardware
                    quickstats = summary.quickStats
                    total_bytes = 0
                    free_bytes = 0
                    for datastore in getattr(esxi_host, "datastore", []) or []:
                        ds_summary = datastore.summary
                        total_bytes += ds_summary.capacity or 0
                        free_bytes += ds_summary.freeSpace or 0

                    # Determine serial number with fallbacks (systemInfo, summary.otherIdentifyingInfo)
                    serial_val = getattr(getattr(hardware, "systemInfo", None), "serialNumber", None)
                    if not serial_val:
                        # otherIdentifyingInfo can contain vendor-specific identifier tuples
                        other = getattr(summary.hardware, "otherIdentifyingInfo", None)
                        if other:
                            for info in other:
                                # identifierType may expose label or key that indicates serial/service tag
                                id_type = getattr(info, "identifierType", None)
                                label = getattr(id_type, "label", None) or getattr(id_type, "key", None) or ""
                                if "serial" in str(label).lower() or "service" in str(label).lower():
                                    serial_val = getattr(info, "identifierValue", None)
                                    break

                    host_config = getattr(esxi_host, "config", None)
                    host_net = getattr(host_config, "network", None) if host_config else None
                    nics, mgmt_ip = _host_nics_and_mgmt(esxi_host, host_net)
                    portgroups = _host_portgroups(host_net)

                    hosts.append(
                        VsphereHost(
                            name=_resolve_host_name(getattr(summary.config, "name", None)),
                            cluster=cluster_name,
                            hardware_model=getattr(hardware, "model", None),
                            serial=serial_val,
                            connection_state=str(summary.runtime.connectionState) if summary.runtime else "unknown",
                            power_state=str(summary.runtime.powerState) if summary.runtime else "unknown",
                            cpu_cores=getattr(hardware, "numCpuCores", None),
                            cpu_usage_mhz=getattr(quickstats, "overallCpuUsage", None),
                            memory_total_mb=(getattr(hardware, "memorySize", None) or 0) // (1024 * 1024)
                            if getattr(hardware, "memorySize", None)
                            else None,
                            memory_usage_mb=getattr(quickstats, "overallMemoryUsage", None),
                            uptime_seconds=getattr(quickstats, "uptime", None),
                            datastore_total_gb=_bytes_to_gb(total_bytes),
                            datastore_free_gb=_bytes_to_gb(free_bytes),
                            vendor=getattr(hardware, "vendor", None),
                            cpu_model=getattr(hardware, "cpuModel", None),
                            bios_version=getattr(getattr(hardware, "biosInfo", None), "biosVersion", None),
                            esxi_version=getattr(getattr(host_config, "product", None), "fullName", None) if host_config else None,
                            management_ip=mgmt_ip,
                            nics=nics,
                            portgroups=portgroups,
                        )
                    )

            vm_folder = getattr(datacenter, "vmFolder", None)
            if vm_folder is None:
                continue
            for entity in vm_folder.childEntity:
                # Skip folders/other entities
                if not hasattr(entity, "summary"):
                    continue
                summary = entity.summary
                quickstats = summary.quickStats
                storage = getattr(summary, "storage", None)
                runtime = summary.runtime
                host_ref = getattr(runtime, "host", None) if runtime else None
                guest = summary.guest

                vm_datastores = [ds.name for ds in getattr(entity, "datastore", []) or []]
                vm_networks = [net.name for net in getattr(entity, "network", []) or []]

                virtual_machines.append(
                    VsphereVirtualMachine(
                        name=summary.config.name,
                        host_name=_resolve_host_name(host_ref.name) if host_ref else None,
                        guest_os=summary.config.guestFullName if summary.config else None,
                        power_state=str(runtime.powerState) if runtime else "unknown",
                        ip_address=guest.ipAddress if guest else None,
                        cpu_count=summary.config.numCpu if summary.config else None,
                        memory_mb=summary.config.memorySizeMB if summary.config else None,
                        cpu_usage_mhz=getattr(quickstats, "overallCpuUsage", None),
                        memory_usage_mb=getattr(quickstats, "guestMemoryUsage", None),
                        used_storage_gb=_bytes_to_gb(getattr(storage, "committed", None) if storage else None),
                        provisioned_storage_gb=_bytes_to_gb(getattr(quickstats, "committedStorage", None)),
                        datastores=vm_datastores,
                        networks=vm_networks,
                        tools_status=guest.toolsRunningStatus if guest else None,
                    )
                )

            for datastore in getattr(datacenter, "datastore", []) or []:
                summary = getattr(datastore, "summary", None)
                name = getattr(summary, "name", None)
                if not name:
                    continue
                datastore_map[name] = VsphereDatastore(
                    name=name,
                    type=getattr(summary, "type", None),
                    capacity_gb=_bytes_to_gb(getattr(summary, "capacity", None)),
                    free_gb=_bytes_to_gb(getattr(summary, "freeSpace", None)),
                )

            for network in getattr(datacenter, "network", []) or []:
                name = getattr(network, "name", None)
                if name:
                    network_names.add(name)

        return VsphereSnapshot(
            collected_at=datetime.now(timezone.utc),
            hosts=hosts,
            virtual_machines=virtual_machines,
            datastores=list(datastore_map.values()),
            networks=[VsphereNetwork(name=value) for value in sorted(network_names)],
        )
    finally:
        Disconnect(si)