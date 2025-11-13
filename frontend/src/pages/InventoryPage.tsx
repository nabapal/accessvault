import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import {
  fetchInventoryDatastores,
  fetchInventoryEndpoints,
  fetchInventoryHosts,
  fetchInventoryNetworks,
  fetchInventoryVirtualMachines
} from "@/services/inventory";
import {
  InventoryEndpoint,
  InventoryEndpointStatus,
  InventoryHost,
  InventoryHostConnectionState,
  InventoryPowerState,
  InventoryDatastore,
  InventoryNetwork,
  InventoryVirtualMachine
} from "@/types";
import { useAuthStore } from "@/stores/auth";

const statusColors: Record<InventoryEndpointStatus, string> = {
  ok: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  error: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  never: "border-slate-500/50 bg-slate-500/10 text-slate-200"
};

const statusLabels: Record<InventoryEndpointStatus, string> = {
  ok: "Healthy",
  error: "Attention",
  never: "Pending"
};

const hostConnectionColors: Record<InventoryHostConnectionState, string> = {
  connected: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  disconnected: "bg-rose-500/15 text-rose-200 border-rose-400/40",
  maintenance: "bg-amber-500/15 text-amber-200 border-amber-400/40"
};

const hostConnectionLabels: Record<InventoryHostConnectionState, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  maintenance: "Maintenance"
};

const powerStateColors: Record<InventoryPowerState, string> = {
  powered_on: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  powered_off: "bg-slate-500/15 text-slate-200 border-slate-400/40",
  suspended: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  unknown: "bg-slate-500/15 text-slate-200 border-slate-400/40"
};

const powerStateLabels: Record<InventoryPowerState, string> = {
  powered_on: "Powered On",
  powered_off: "Powered Off",
  suspended: "Suspended",
  unknown: "Unknown"
};

const PAGE_SIZE_OPTIONS = [5, 10, 20];

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "Never";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const formatSource = (source: InventoryEndpoint["source_type"]) => {
  if (source === "vcenter") {
    return "vCenter";
  }
  return "ESXi Host";
};

export function InventoryPage() {
  const [endpoints, setEndpoints] = useState<InventoryEndpoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hosts, setHosts] = useState<InventoryHost[]>([]);
  const [virtualMachines, setVirtualMachines] = useState<InventoryVirtualMachine[]>([]);
  const [datastores, setDatastores] = useState<InventoryDatastore[]>([]);
  const [networks, setNetworks] = useState<InventoryNetwork[]>([]);
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [hostSearch, setHostSearch] = useState<string>("");
  const [datastoreSearch, setDatastoreSearch] = useState<string>("");
  const [networkSearch, setNetworkSearch] = useState<string>("");
  const [hostPage, setHostPage] = useState<number>(1);
  const [hostPageSize, setHostPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);
  const [datastorePage, setDatastorePage] = useState<number>(1);
  const [datastorePageSize, setDatastorePageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);
  const [networkPage, setNetworkPage] = useState<number>(1);
  const [networkPageSize, setNetworkPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);
  const isAdmin = useAuthStore((state) => state.user?.role === "admin");

  useEffect(() => {
    let isMounted = true;
    const loadEndpoints = async () => {
      setIsLoading(true);
      try {
        const data = await fetchInventoryEndpoints();
        if (isMounted) {
          setEndpoints(data);
          setError(null);
        }
      } catch {
        if (isMounted) {
          setError("Unable to load inventory collectors. Please try again.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadEndpoints();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadInventory = async () => {
      setIsInventoryLoading(true);
      try {
        const [hostData, vmData, datastoreData, networkData] = await Promise.all([
          fetchInventoryHosts(),
          fetchInventoryVirtualMachines(),
          fetchInventoryDatastores(),
          fetchInventoryNetworks()
        ]);
        if (isMounted) {
          setHosts(hostData);
          setVirtualMachines(vmData);
          setDatastores(datastoreData);
          setNetworks(networkData);
          setInventoryError(null);
        }
      } catch {
        if (isMounted) {
          setInventoryError("Unable to load inventory telemetry.");
        }
      } finally {
        if (isMounted) {
          setIsInventoryLoading(false);
        }
      }
    };

    loadInventory();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setHostPage(1);
  }, [hostSearch]);

  useEffect(() => {
    setDatastorePage(1);
  }, [datastoreSearch]);

  useEffect(() => {
    setNetworkPage(1);
  }, [networkSearch]);

  const totals = useMemo(() => {
    const hostCount = hosts.length;
    const vmCount = virtualMachines.length;
    const datastoreTotal = hosts.reduce((acc, host) => acc + (host.datastore_total_gb ?? 0), 0);
    const datastoreFree = hosts.reduce((acc, host) => acc + (host.datastore_free_gb ?? 0), 0);
    const datastoreCount = datastores.length;
    const networkCount = networks.length;
    return { hostCount, vmCount, datastoreTotal, datastoreFree, datastoreCount, networkCount };
  }, [datastores.length, hosts, networks.length, virtualMachines]);

  const endpointStats = useMemo(() => {
    if (endpoints.length === 0) {
      return { total: 0, healthy: 0, attention: 0, successRate: null as number | null };
    }
    const healthy = endpoints.filter((endpoint) => endpoint.last_poll_status === "ok").length;
    const attention = endpoints.filter((endpoint) => endpoint.last_poll_status === "error").length;
    const successRate = Math.round((healthy / endpoints.length) * 100);
    return { total: endpoints.length, healthy, attention, successRate };
  }, [endpoints]);

  const hostVmCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    virtualMachines.forEach((vm) => {
      if (!vm.host_id) {
        return;
      }
      counts[vm.host_id] = (counts[vm.host_id] ?? 0) + 1;
    });
    return counts;
  }, [virtualMachines]);

  const endpointDatastoreCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    datastores.forEach((datastore) => {
      counts[datastore.endpoint_id] = (counts[datastore.endpoint_id] ?? 0) + 1;
    });
    return counts;
  }, [datastores]);

  const filteredHosts = useMemo(() => {
    const query = hostSearch.trim().toLowerCase();
    if (!query) {
      return hosts;
    }
    return hosts.filter((host) => {
      const values = [
        host.name,
        host.cluster ?? "",
        host.endpoint_name,
        host.hardware_model ?? "",
        host.serial ?? "",
        host.site_name ?? "",
        host.rack_location ?? ""
      ];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [hostSearch, hosts]);

  const filteredDatastores = useMemo(() => {
    const query = datastoreSearch.trim().toLowerCase();
    if (!query) {
      return datastores;
    }
    return datastores.filter((datastore) => {
      const values = [datastore.name, datastore.endpoint_name, datastore.type ?? ""];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [datastoreSearch, datastores]);

  const filteredNetworks = useMemo(() => {
    const query = networkSearch.trim().toLowerCase();
    if (!query) {
      return networks;
    }
    return networks.filter((network) => {
      const values = [network.name, network.endpoint_name];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [networkSearch, networks]);

  const hostTotal = filteredHosts.length;
  const hostTotalPages = hostTotal > 0 ? Math.ceil(hostTotal / hostPageSize) : 1;
  useEffect(() => {
    if (hostPage > hostTotalPages) {
      setHostPage(hostTotalPages);
    }
  }, [hostPage, hostTotalPages]);
  const paginatedHosts = useMemo(() => {
    if (!hostTotal) {
      return [];
    }
    const start = (hostPage - 1) * hostPageSize;
    return filteredHosts.slice(start, start + hostPageSize);
  }, [filteredHosts, hostPage, hostPageSize, hostTotal]);
  const hostRangeStart = hostTotal === 0 ? 0 : (hostPage - 1) * hostPageSize + 1;
  const hostRangeEnd = hostTotal === 0 ? 0 : Math.min(hostPage * hostPageSize, hostTotal);

  const datastoreTotal = filteredDatastores.length;
  const datastoreTotalPages = datastoreTotal > 0 ? Math.ceil(datastoreTotal / datastorePageSize) : 1;
  useEffect(() => {
    if (datastorePage > datastoreTotalPages) {
      setDatastorePage(datastoreTotalPages);
    }
  }, [datastorePage, datastoreTotalPages]);
  const paginatedDatastores = useMemo(() => {
    if (!datastoreTotal) {
      return [];
    }
    const start = (datastorePage - 1) * datastorePageSize;
    return filteredDatastores.slice(start, start + datastorePageSize);
  }, [filteredDatastores, datastorePage, datastorePageSize, datastoreTotal]);
  const datastoreRangeStart = datastoreTotal === 0 ? 0 : (datastorePage - 1) * datastorePageSize + 1;
  const datastoreRangeEnd = datastoreTotal === 0 ? 0 : Math.min(datastorePage * datastorePageSize, datastoreTotal);

  const networkTotal = filteredNetworks.length;
  const networkTotalPages = networkTotal > 0 ? Math.ceil(networkTotal / networkPageSize) : 1;
  useEffect(() => {
    if (networkPage > networkTotalPages) {
      setNetworkPage(networkTotalPages);
    }
  }, [networkPage, networkTotalPages]);
  const paginatedNetworks = useMemo(() => {
    if (!networkTotal) {
      return [];
    }
    const start = (networkPage - 1) * networkPageSize;
    return filteredNetworks.slice(start, start + networkPageSize);
  }, [filteredNetworks, networkPage, networkPageSize, networkTotal]);
  const networkRangeStart = networkTotal === 0 ? 0 : (networkPage - 1) * networkPageSize + 1;
  const networkRangeEnd = networkTotal === 0 ? 0 : Math.min(networkPage * networkPageSize, networkTotal);

  const endpointEvents = useMemo(() => {
    return endpoints
      .flatMap((endpoint) => {
        const events: {
          id: string;
          severity: "error" | "warning";
          message: string;
          timestamp?: string | null;
          endpointName: string;
        }[] = [];
        if (endpoint.last_poll_status === "error") {
          events.push({
            id: `${endpoint.id}-status`,
            severity: "error",
            message: endpoint.last_error_message || "Latest poll failed. Investigate credentials or connectivity.",
            timestamp: endpoint.last_polled_at ?? endpoint.updated_at,
            endpointName: endpoint.name || endpoint.address
          });
        }
        if (!endpoint.last_polled_at && endpoint.last_poll_status === "never") {
          events.push({
            id: `${endpoint.id}-never`,
            severity: "warning",
            message: "Awaiting first successful poll. Ensure onboarding is complete.",
            timestamp: endpoint.created_at,
            endpointName: endpoint.name || endpoint.address
          });
        }
        return events;
      })
      .sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
      });
  }, [endpoints]);

  const formatGigabytes = (value?: number | null) => {
    if (value === undefined || value === null) {
      return "--";
    }
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} TB`;
    }
    if (value >= 10) {
      return `${Math.round(value)} GB`;
    }
    return `${value.toFixed(1)} GB`;
  };

  const formatMemory = (value?: number | null) => {
    if (!value) {
      return "--";
    }
    return `${Math.round(value / 1024)} GB`;
  };

  const formatPercent = (value?: number | null) => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return "--";
    }
    return `${Math.min(100, Math.max(0, Math.round(value)))}%`;
  };

  const formatUptime = (seconds?: number | null) => {
    if (!seconds) {
      return "--";
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const calculateDatastorePercent = (datastore: InventoryDatastore) => {
    if (!datastore.capacity_gb || datastore.capacity_gb <= 0) {
      return null;
    }
    const free = datastore.free_gb ?? 0;
    const used = Math.max(0, datastore.capacity_gb - free);
    return (used / datastore.capacity_gb) * 100;
  };

  const calculateCpuPercent = (host: InventoryHost) => {
    if (!host.cpu_cores || host.cpu_cores <= 0 || !host.cpu_usage_mhz) {
      return null;
    }
    const theoreticalMhz = host.cpu_cores * 2500;
    return (host.cpu_usage_mhz / theoreticalMhz) * 100;
  };

  const calculateMemoryPercent = (host: InventoryHost) => {
    if (!host.memory_total_mb || host.memory_total_mb <= 0 || !host.memory_usage_mb) {
      return null;
    }
    return (host.memory_usage_mb / host.memory_total_mb) * 100;
  };

  const hostAverages = useMemo(() => {
    if (hosts.length === 0) {
      return { cpu: null as number | null, memory: null as number | null };
    }

    let cpuSum = 0;
    let cpuCount = 0;
    let memorySum = 0;
    let memoryCount = 0;

    hosts.forEach((host) => {
      const cpuPercent = calculateCpuPercent(host);
      if (cpuPercent !== null) {
        cpuSum += cpuPercent;
        cpuCount += 1;
      }

      const memoryPercent = calculateMemoryPercent(host);
      if (memoryPercent !== null) {
        memorySum += memoryPercent;
        memoryCount += 1;
      }
    });

    return {
      cpu: cpuCount > 0 ? cpuSum / cpuCount : null,
      memory: memoryCount > 0 ? memorySum / memoryCount : null
    };
  }, [hosts]);

  const hostResourceTotals = useMemo(() => {
    let totalCpuMhz = 0;
    let usedCpuMhz = 0;
    let totalMemoryMb = 0;
    let usedMemoryMb = 0;

    hosts.forEach((host) => {
      if (host.cpu_cores && host.cpu_cores > 0) {
        totalCpuMhz += host.cpu_cores * 2500;
      }
      if (host.cpu_usage_mhz) {
        usedCpuMhz += host.cpu_usage_mhz;
      }
      if (host.memory_total_mb) {
        totalMemoryMb += host.memory_total_mb;
      }
      if (host.memory_usage_mb) {
        usedMemoryMb += host.memory_usage_mb;
      }
    });

    return {
      totalCpuMhz,
      usedCpuMhz,
      totalMemoryMb,
      usedMemoryMb,
      cpuPercent: totalCpuMhz > 0 ? (usedCpuMhz / totalCpuMhz) * 100 : null,
      memoryPercent: totalMemoryMb > 0 ? (usedMemoryMb / totalMemoryMb) * 100 : null
    };
  }, [hosts]);

  const formatGigahertz = (value?: number | null) => {
    if (!value) {
      return "--";
    }
    const ghz = value / 1000;
    if (ghz >= 100) {
      return `${Math.round(ghz)} GHz`;
    }
    if (ghz >= 10) {
      return `${ghz.toFixed(1)} GHz`;
    }
    return `${ghz.toFixed(2)} GHz`;
  };

  const summaryTiles = useMemo(
    () => [
      {
        label: "Hosts",
        value: totals.hostCount ? totals.hostCount.toString() : "--",
        description:
          totals.hostCount > 0
            ? `Avg CPU ${formatPercent(hostAverages.cpu)} • Avg memory ${formatPercent(hostAverages.memory)}`
            : "Awaiting first poll"
      },
      {
        label: "CPU Utilization",
        value: hostResourceTotals.cpuPercent !== null ? formatPercent(hostResourceTotals.cpuPercent) : "--",
        description:
          hostResourceTotals.totalCpuMhz > 0
            ? `${formatGigahertz(hostResourceTotals.usedCpuMhz)} used / ${formatGigahertz(hostResourceTotals.totalCpuMhz)} total`
            : "Awaiting host telemetry"
      },
      {
        label: "Memory Utilization",
        value: hostResourceTotals.memoryPercent !== null ? formatPercent(hostResourceTotals.memoryPercent) : "--",
        description:
          hostResourceTotals.totalMemoryMb > 0
            ? `${formatGigabytes(hostResourceTotals.usedMemoryMb / 1024)} used / ${formatGigabytes(hostResourceTotals.totalMemoryMb / 1024)} total`
            : "Awaiting host telemetry"
      },
      {
        label: "Virtual Machines",
        value: totals.vmCount ? totals.vmCount.toString() : "--",
        description: totals.vmCount ? `${hosts.length} hosts reporting` : "Awaiting first poll"
      },
      {
        label: "Datastore Capacity",
        value: totals.datastoreTotal ? formatGigabytes(totals.datastoreTotal) : "--",
        description:
          totals.datastoreTotal > 0
            ? `${formatGigabytes(Math.max(0, totals.datastoreTotal - totals.datastoreFree))} used / ${formatGigabytes(totals.datastoreFree)} free`
            : "Awaiting collector metrics"
      },
      {
        label: "Collectors",
        value: endpointStats.total ? endpointStats.total.toString() : "--",
        description:
          endpointStats.total > 0
            ? `${endpointStats.healthy} healthy • ${endpointStats.attention} needs attention`
            : "Add endpoints to begin polling"
      },
      {
        label: "Poll Success",
        value: endpointStats.successRate !== null ? `${endpointStats.successRate}%` : "--",
        description:
          endpointStats.total > 0
            ? "Rolling success rate across enrolled collectors"
            : "Awaiting first poll"
      },
      {
        label: "Inventory Datastores",
        value: totals.datastoreCount ? totals.datastoreCount.toString() : "--",
        description:
          totals.datastoreCount > 0
            ? `${formatGigabytes(Math.max(0, totals.datastoreTotal - totals.datastoreFree))} used across datastores`
            : "Waiting for collector data"
      },
      {
        label: "Networks",
        value: totals.networkCount ? totals.networkCount.toString() : "--",
        description: totals.networkCount ? "Discovered port groups and segments" : "Awaiting collector data"
      }
    ],
    [endpointStats, hostAverages, hostResourceTotals, hosts.length, totals]
  );
  return (
    <AppShell>
      <div className="space-y-6">
        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-5 shadow-inner shadow-black/20">
          <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Live Infrastructure Overview</h2>
              <p className="text-sm text-slate-300">
                Real-time health and inventory snapshots across all connected data center assets.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isAdmin && (
                <Link
                  to="/inventory/admin"
                  className="inline-flex items-center justify-center rounded-md border border-brand-700 bg-brand-800 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
                >
                  Manage collectors
                </Link>
              )}
              <Link
                to="/inventory/virtual-machines"
                className="inline-flex items-center justify-center rounded-md border border-primary-500/40 bg-primary-500/20 px-3 py-1 text-xs font-medium text-primary-100 transition hover:bg-primary-500/30"
              >
                Open VM center
              </Link>
              <div className="rounded-full border border-primary-500/40 px-4 py-1 text-xs font-medium uppercase tracking-[0.3em] text-primary-200">
                Live feed
              </div>
            </div>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
            {summaryTiles.map((tile) => (
              <div key={tile.label} className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">{tile.label}</p>
                <p className="mt-2 text-2xl font-semibold text-primary-100">{tile.value}</p>
                <p className="text-xs text-slate-500">{tile.description}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Events &amp; alerts</h3>
            <span className="text-xs text-slate-400">{endpointEvents.length} active</span>
          </div>
          {endpointEvents.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No recent poll failures detected. Everything looks stable.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              {endpointEvents.slice(0, 6).map((event) => (
                <li key={event.id} className="rounded-lg border border-brand-800/60 bg-brand-900/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-100">{event.endpointName}</p>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        event.severity === "error"
                          ? "border-rose-500/50 bg-rose-500/15 text-rose-200"
                          : "border-amber-500/50 bg-amber-500/15 text-amber-200"
                      }`}
                    >
                      {event.severity === "error" ? "Failure" : "Pending"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{event.message}</p>
                  {event.timestamp && (
                    <p className="mt-2 text-[11px] text-slate-500">{formatDateTime(event.timestamp)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {endpointEvents.length > 6 && (
            <p className="mt-3 text-[11px] text-slate-500">Showing recent 6 events. See Inventory Admin for the full log.</p>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-1">
          <div className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-200">Host Utilization</h3>
                {isInventoryLoading && <span className="text-xs text-slate-400">Loading…</span>}
              </div>
              <div className="w-full sm:w-auto">
                <label className="sr-only" htmlFor="host-search">
                  Search hosts
                </label>
                <input
                  id="host-search"
                  type="search"
                  autoComplete="off"
                  placeholder="Search hosts…"
                  className="w-full rounded border border-brand-700 bg-brand-900 px-3 py-1 text-sm text-slate-200 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-56"
                  value={hostSearch}
                  onChange={(event) => setHostSearch(event.target.value)}
                />
              </div>
            </div>
            {!isInventoryLoading && inventoryError && <p className="mt-4 text-sm text-rose-300">{inventoryError}</p>}
            {!isInventoryLoading && !inventoryError && hosts.length === 0 && (
              <p className="mt-4 text-sm text-slate-400">No host telemetry yet. Poller will populate data after the first cycle.</p>
            )}
            {!isInventoryLoading && !inventoryError && hosts.length > 0 && filteredHosts.length === 0 && (
              <p className="mt-4 text-sm text-slate-400">No hosts match your search.</p>
            )}
            {!isInventoryLoading && !inventoryError && hosts.length > 0 && filteredHosts.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-2 text-left">Host</th>
                      <th className="px-2 text-left">Serial</th>
                      <th className="px-2 text-left">Site</th>
                      <th className="px-2 text-left">Rack</th>
                      <th className="px-2 text-left">Server Model</th>
                      <th className="px-2 text-left">CPU</th>
                      <th className="px-2 text-left">Memory</th>
                      <th className="px-2 text-left">Storage</th>
                      <th className="px-2 text-left">VMs</th>
                      <th className="px-2 text-left">Datastores</th>
                      <th className="px-2 text-left">Uptime</th>
                      <th className="px-2 text-left">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHosts.map((host) => {
                      const cpuPercent = calculateCpuPercent(host);
                      const memPercent = calculateMemoryPercent(host);
                      const vmCount = hostVmCounts[host.id] ?? 0;
                      const datastoreCount = endpointDatastoreCounts[host.endpoint_id] ?? 0;
                      return (
                        <tr key={host.id} className="rounded-lg border border-brand-800/70 bg-brand-900/80">
                          <td className="px-2 py-2 align-top">
                            <div className="font-semibold text-slate-100">{host.name}</div>
                            <div className="text-xs text-slate-400">{host.cluster ?? host.endpoint_name}</div>
                          </td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{host.serial ?? "MISSING"}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{host.site_name ?? "--"}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{host.rack_location ?? "--"}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{host.hardware_model ?? "--"}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">
                            <div>{formatPercent(cpuPercent)}</div>
                            <div className="text-slate-500">{host.cpu_cores ? `${host.cpu_cores} cores` : "--"}</div>
                          </td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">
                            <div>{formatPercent(memPercent)}</div>
                            <div className="text-slate-500">{formatMemory(host.memory_total_mb)}</div>
                          </td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">
                            <div>{formatGigabytes((host.datastore_total_gb ?? 0) - (host.datastore_free_gb ?? 0))} used</div>
                            <div className="text-slate-500">{formatGigabytes(host.datastore_free_gb)} free</div>
                          </td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{vmCount}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{datastoreCount}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{formatUptime(host.uptime_seconds)}</td>
                          <td className="px-2 py-2 align-top">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${hostConnectionColors[host.connection_state]}`}
                            >
                              {hostConnectionLabels[host.connection_state]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">
                    Showing {hostRangeStart}-{hostRangeEnd} of {hostTotal} hosts
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Rows</span>
                      <select
                        value={hostPageSize}
                        onChange={(event) => {
                          setHostPageSize(Number(event.currentTarget.value));
                          setHostPage(1);
                        }}
                        className="rounded border border-brand-700 bg-brand-900/80 px-2 py-1 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setHostPage((prev) => Math.max(1, prev - 1))}
                        disabled={hostPage <= 1}
                      >
                        Previous
                      </button>
                      <span>
                        Page {hostPage} of {hostTotalPages}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setHostPage((prev) => Math.min(hostTotalPages, prev + 1))}
                        disabled={hostPage >= hostTotalPages}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="space-y-4">
          <div className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-200">Datastore Utilization</h3>
                {isInventoryLoading && <span className="text-xs text-slate-400">Loading…</span>}
              </div>
              <div className="w-full sm:w-auto">
                <label className="sr-only" htmlFor="datastore-search">
                  Search datastores
                </label>
                <input
                  id="datastore-search"
                  type="search"
                  autoComplete="off"
                  placeholder="Search datastores…"
                  className="w-full rounded border border-brand-700 bg-brand-900 px-3 py-1 text-sm text-slate-200 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-56"
                  value={datastoreSearch}
                  onChange={(event) => setDatastoreSearch(event.target.value)}
                />
              </div>
            </div>
            {!isInventoryLoading && inventoryError && <p className="mt-4 text-sm text-rose-300">{inventoryError}</p>}
            {!isInventoryLoading && !inventoryError && datastores.length === 0 && (
              <p className="mt-4 text-sm text-slate-400">No datastores discovered yet. Poller will sync storage assets shortly.</p>
            )}
            {!isInventoryLoading && !inventoryError && datastores.length > 0 && filteredDatastores.length === 0 && (
              <p className="mt-4 text-sm text-slate-400">No datastores match your search.</p>
            )}
            {!isInventoryLoading && !inventoryError && datastores.length > 0 && filteredDatastores.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-2 text-left">Datastore</th>
                      <th className="px-2 text-left">Type</th>
                      <th className="px-2 text-left">Capacity</th>
                      <th className="px-2 text-left">Free</th>
                      <th className="px-2 text-left">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDatastores.map((datastore) => {
                      const usagePercent = calculateDatastorePercent(datastore);
                      const free = datastore.free_gb ?? undefined;
                      const used = datastore.capacity_gb ? Math.max(0, datastore.capacity_gb - (datastore.free_gb ?? 0)) : undefined;
                      return (
                        <tr key={datastore.id} className="rounded-lg border border-brand-800/70 bg-brand-900/80">
                          <td className="px-2 py-2 align-top">
                            <div className="font-semibold text-slate-100">{datastore.name}</div>
                            <div className="text-xs text-slate-400">{datastore.endpoint_name}</div>
                          </td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{datastore.type ?? "--"}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{formatGigabytes(datastore.capacity_gb)}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">{formatGigabytes(free)}</td>
                          <td className="px-2 py-2 align-top text-xs text-slate-300">
                            <div>{formatPercent(usagePercent)}</div>
                            <div className="text-slate-500">{formatGigabytes(used)} used</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">
                    Showing {datastoreRangeStart}-{datastoreRangeEnd} of {datastoreTotal} datastores
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Rows</span>
                      <select
                        value={datastorePageSize}
                        onChange={(event) => {
                          setDatastorePageSize(Number(event.currentTarget.value));
                          setDatastorePage(1);
                        }}
                        className="rounded border border-brand-700 bg-brand-900/80 px-2 py-1 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setDatastorePage((prev) => Math.max(1, prev - 1))}
                        disabled={datastorePage <= 1}
                      >
                        Previous
                      </button>
                      <span>
                        Page {datastorePage} of {datastoreTotalPages}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setDatastorePage((prev) => Math.min(datastoreTotalPages, prev + 1))}
                        disabled={datastorePage >= datastoreTotalPages}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-200">Available Networks</h3>
                {isInventoryLoading && <span className="text-xs text-slate-400">Loading…</span>}
              </div>
              <div className="w-full sm:w-auto">
                <label className="sr-only" htmlFor="network-search">
                  Search networks
                </label>
                <input
                  id="network-search"
                  type="search"
                  autoComplete="off"
                  placeholder="Search networks…"
                  className="w-full rounded border border-brand-700 bg-brand-900 px-3 py-1 text-sm text-slate-200 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-56"
                  value={networkSearch}
                  onChange={(event) => setNetworkSearch(event.target.value)}
                />
              </div>
            </div>
            {!isInventoryLoading && inventoryError && <p className="mt-2 text-sm text-rose-300">{inventoryError}</p>}
            {!isInventoryLoading && !inventoryError && networks.length === 0 && (
              <p className="mt-2 text-sm text-slate-400">No networks discovered yet. Inventory sync will populate overlays soon.</p>
            )}
            {!isInventoryLoading && !inventoryError && networks.length > 0 && filteredNetworks.length === 0 && (
              <p className="mt-2 text-sm text-slate-400">No networks match your search.</p>
            )}
            {!isInventoryLoading && !inventoryError && networks.length > 0 && filteredNetworks.length > 0 && (
              <>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {paginatedNetworks.map((network) => (
                    <li key={network.id} className="rounded border border-brand-800/60 bg-brand-900/70 px-3 py-2 text-sm text-slate-200">
                      <p className="font-semibold text-primary-100">{network.name}</p>
                      <p className="text-xs text-slate-400">{network.endpoint_name}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">
                    Showing {networkRangeStart}-{networkRangeEnd} of {networkTotal} networks
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Rows</span>
                      <select
                        value={networkPageSize}
                        onChange={(event) => {
                          setNetworkPageSize(Number(event.currentTarget.value));
                          setNetworkPage(1);
                        }}
                        className="rounded border border-brand-700 bg-brand-900/80 px-2 py-1 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setNetworkPage((prev) => Math.max(1, prev - 1))}
                        disabled={networkPage <= 1}
                      >
                        Previous
                      </button>
                      <span>
                        Page {networkPage} of {networkTotalPages}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setNetworkPage((prev) => Math.min(networkTotalPages, prev + 1))}
                        disabled={networkPage >= networkTotalPages}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
