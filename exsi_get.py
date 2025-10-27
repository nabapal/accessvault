from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import ssl
import humanize

# --- ESXi Connection Details ---
host = "10.64.90.3"
user = "root"
password = "rancore@123"

# --- SSL Context (ignore cert validation) ---
context = ssl._create_unverified_context()
print(f"Connecting to ESXi host {host} ...")

si = SmartConnect(host=host, user=user, pwd=password, sslContext=context)
content = si.RetrieveContent()

# --- Host Summary ---
for datacenter in content.rootFolder.childEntity:
    for compute_resource in datacenter.hostFolder.childEntity:
        for esxi_host in compute_resource.host:
            summary = esxi_host.summary
            hw = summary.hardware
            quickstats = summary.quickStats

            print("\n=== Host Summary ===")
            print(f"Host: {summary.config.name}")
            print(f"Product: {summary.config.product.fullName}")
            print(f"Server Model: {hw.model}")
            print(f"CPU Cores: {hw.numCpuCores}")
            print(f"CPU MHz/Core: {hw.cpuMhz}")
            print(f"Memory: {humanize.naturalsize(hw.memorySize)}")
            print(f"Uptime: {quickstats.uptime // 3600} hours")

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

