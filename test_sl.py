#!/usr/bin/env python3
"""
Get host serial numbers from vCenter/vSphere using pyVmomi.
Falls back to alternative fields and prints notes when serial is not exposed.
"""

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim, vmodl
import ssl
import logging
import sys

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def connect_vcenter(host, user, pwd, port=443, disable_ssl_verify=True):
    if disable_ssl_verify:
        ctx = ssl._create_unverified_context()
    else:
        ctx = None
    si = SmartConnect(host=host, user=user, pwd=pwd, port=port, sslContext=ctx)
    return si

def iter_hosts(content):
    """
    Yield vim.HostSystem objects for datacenters/clusters & standalone hosts.
    Works with different inventory layouts.
    """
    obj_view = content.viewManager.CreateContainerView(
        container=content.rootFolder, type=[vim.HostSystem], recursive=True)
    try:
        for host in obj_view.view:
            yield host
    finally:
        obj_view.Destroy()

def get_serial_from_host(host):
    # primary
    try:
        serial = getattr(host.hardware.systemInfo, "serialNumber", None)
    except Exception:
        serial = None

    # alternative: summary.hardware.otherIdentifyingInfo (vendor tags)
    if not serial:
        other = getattr(host.summary.hardware, "otherIdentifyingInfo", None)
        if other:
            for info in other:
                label = getattr(info.identifierType, "label", "") or getattr(info.identifierType, "key", "")
                if "serial" in str(label).lower() or "service" in str(label).lower():
                    serial = info.identifierValue
                    break

    return serial

def main():
    VCENTER = "10.64.90.3"
    USER = "root"
    PASS = "rancore@123"

    try:
        si = connect_vcenter(VCENTER, USER, PASS)
    except Exception as e:
        logger.exception("Failed to connect to vCenter: %s", e)
        sys.exit(1)

    content = si.RetrieveContent()

    for host in iter_hosts(content):
        name = host.name
        serial = get_serial_from_host(host)
        if serial:
            logger.info("%s -> %s", name, serial)
        else:
            logger.warning("%s -> serial not available via API (None). Consider SSH fallback or enabling vendor CIM.", name)

    Disconnect(si)

if __name__ == "__main__":
    main()
