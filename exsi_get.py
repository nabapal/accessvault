from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import ssl
import humanize


def get_serial_from_host(host):
    """Return a serial number for a vim.HostSystem or None if not found.

    Tries hardware.systemInfo.serialNumber first, then falls back to
    summary.hardware.otherIdentifyingInfo vendor tags.
    """
    serial = None
    try:
        serial = getattr(host.hardware.systemInfo, "serialNumber", None)
    except Exception:
        serial = None

    if not serial:
        other = getattr(getattr(host, "summary", None), "hardware", None)
        other = getattr(other, "otherIdentifyingInfo", None) if other else None
        if other:
            for info in other:
                id_type = getattr(info, "identifierType", None)
                label = getattr(id_type, "label", None) or getattr(id_type, "key", None) or ""
                if "serial" in str(label).lower() or "service" in str(label).lower():
                    serial = getattr(info, "identifierValue", None)
                    break

    return serial

# --- ESXi Connection Details ---
host = "10.64.90.3"
user = "root"
password = "rancore@123"

# --- SSL Context (ignore cert validation) ---
context = ssl._create_unverified_context()
print(f"Connecting to ESXi host {host} ...")

si = SmartConnect(host=host, user=user, pwd=password, sslContext=context)
content = si.RetrieveContent()

# --- Host Summary (simplified loop to directly read systemInfo) ---
for datacenter in content.rootFolder.childEntity:
    for cluster in datacenter.hostFolder.childEntity:
        for host in cluster.host:
            print("\n=== Host Summary ===")
            # Safely determine host display name
            host_name = getattr(host, 'name', None)
            if not host_name:
                try:
                    host_name = host.summary.config.name
                except Exception:
                    host_name = 'unknown'
            print(f"Host: {host_name}")
            # Use helper that mirrors the logic in test_sl.py
            serial = get_serial_from_host(host)

            if serial:
                print(f"Serial Number: {serial}")
            else:
                # Diagnostic: print some systemInfo fields to help locate serial
                system_info = getattr(host.hardware, 'systemInfo', None)
                if system_info:
                    manuf = getattr(system_info, 'manufacturer', None)
                    model = getattr(system_info, 'model', None)
                    uuid = getattr(system_info, 'uuid', None)
                    s_num = getattr(system_info, 'serialNumber', None)
                    print("Serial Number: MISSING")
                    print(f"systemInfo.manufacturer: {manuf}")
                    print(f"systemInfo.model: {model}")
                    print(f"systemInfo.uuid: {uuid}")
                    print(f"systemInfo.serialNumber (raw): {s_num}")
                else:
                    print("Serial Number: MISSING (no systemInfo)")

# --- VM Details ---
print("\n=== Virtual Machines ===")
for datacenter in content.rootFolder.childEntity:
    vm_list = datacenter.vmFolder.childEntity
    for vm in vm_list:
        summary = vm.summary
        name = summary.config.name
        state = summary.runtime.powerState
        guest = summary.config.guestFullName if summary.config else "Unknown"
        ip = summary.guest.ipAddress if summary.guest else "N/A"
        cpu = summary.config.numCpu if summary.config else "?"
        mem = summary.config.memorySizeMB / 1024 if summary.config else "?"
        tools = summary.guest.toolsRunningStatus if summary.guest else "N/A"
        datastore = [ds.name for ds in vm.datastore] if hasattr(vm, "datastore") else []
        network = [net.name for net in vm.network] if hasattr(vm, "network") else []

        print(f"\nVM: {name}")
        print(f"  Power: {state}")
        print(f"  Guest OS: {guest}")
        print(f"  IP: {ip}")
        print(f"  vCPU: {cpu} | Memory: {mem:.1f} GB")
        print(f"  Tools: {tools}")
        print(f"  Datastore: {', '.join(datastore)}")
        print(f"  Network: {', '.join(network)}")

# --- Datastores ---
print("\n=== Datastores ===")
for datacenter in content.rootFolder.childEntity:
    for datastore in datacenter.datastore:
        summary = datastore.summary
        capacity = humanize.naturalsize(summary.capacity)
        free = humanize.naturalsize(summary.freeSpace)
        print(f"Datastore: {summary.name} | Type: {summary.type} | Capacity: {capacity} | Free: {free}")

# --- Networks ---
print("\n=== Networks ===")
for datacenter in content.rootFolder.childEntity:
    for network in datacenter.network:
        print(f"Network: {network.name}")

Disconnect(si)
print("\nDisconnected from ESXi.")

