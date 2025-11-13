import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Set

from pyVim.connect import Disconnect, SmartConnect


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

                    hosts.append(
                        VsphereHost(
                            name=summary.config.name,
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
                        host_name=host_ref.name if host_ref else None,
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