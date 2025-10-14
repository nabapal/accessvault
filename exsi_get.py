from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import ssl

# --- Configuration ---
host = "10.64.90.3"       # Replace with your ESXi host/IP
user = "root"
password = "rancore@123"

# --- Create unverified SSL context (ignore cert validation) ---
context = ssl._create_unverified_context()

print(f"Connecting to ESXi host {host} ...")

# --- Connect to ESXi ---
si = SmartConnect(host=host, user=user, pwd=password, sslContext=context)
content = si.RetrieveContent()

# --- List all VMs ---
for datacenter in content.rootFolder.childEntity:
    if hasattr(datacenter, 'vmFolder'):
        vm_folder = datacenter.vmFolder
        vm_list = vm_folder.childEntity
        for vm in vm_list:
            print(f"VM Name: {vm.name} | Power State: {vm.runtime.powerState}")

Disconnect(si)
print("Disconnected from ESXi.")

