import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import {
  fetchInventoryEndpoints,
  fetchInventoryHosts,
  fetchInventoryVirtualMachines
} from "@/services/inventory";
import {
  InventoryEndpoint,
  InventoryHost,
  InventoryPowerState,
  InventoryVirtualMachine
} from "@/types";

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

interface Filters {
  query: string;
  power: InventoryPowerState | "all";
  endpoint: string;
  host: string;
}

const initialFilters: Filters = {
  query: "",
  power: "all",
  endpoint: "",
  host: ""
};

export function InventoryVMsPage() {
  const [virtualMachines, setVirtualMachines] = useState<InventoryVirtualMachine[]>([]);
  const [hosts, setHosts] = useState<InventoryHost[]>([]);
  const [endpoints, setEndpoints] = useState<InventoryEndpoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ ...initialFilters });
  const [selectedVm, setSelectedVm] = useState<InventoryVirtualMachine | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const [vmData, hostData, endpointData] = await Promise.all([
          fetchInventoryVirtualMachines(),
          fetchInventoryHosts(),
          fetchInventoryEndpoints()
        ]);
        if (!isMounted) {
          return;
        }
        setVirtualMachines(vmData);
        setHosts(hostData);
        setEndpoints(endpointData);
        setLoadError(null);
      } catch (error) {
        if (isMounted) {
          setLoadError((error as Error).message || "Unable to load virtual machine inventory");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedVm) {
      return;
    }
    const refreshed = virtualMachines.find((vm) => vm.id === selectedVm.id);
    if (refreshed) {
      setSelectedVm(refreshed);
    }
  }, [selectedVm, virtualMachines]);

  const summary = useMemo(() => {
    const total = virtualMachines.length;
    const poweredOn = virtualMachines.filter((vm) => vm.power_state === "powered_on").length;
    const poweredOff = virtualMachines.filter((vm) => vm.power_state === "powered_off").length;
    const suspended = virtualMachines.filter((vm) => vm.power_state === "suspended").length;

    const avgCpu = total
      ? Math.round(
          virtualMachines.reduce((acc, vm) => acc + (vm.cpu_usage_mhz ?? 0), 0) / total
        )
      : null;
    const avgMemory = total
      ? Math.round(
          virtualMachines.reduce((acc, vm) => acc + (vm.memory_usage_mb ?? 0), 0) / total
        )
      : null;
    const avgStorage = total
      ? Math.round(
          virtualMachines.reduce((acc, vm) => acc + (vm.used_storage_gb ?? 0), 0) / total
        )
      : null;

    return { total, poweredOn, poweredOff, suspended, avgCpu, avgMemory, avgStorage };
  }, [virtualMachines]);

  const filteredVms = useMemo(() => {
    return virtualMachines.filter((vm) => {
      if (filters.power !== "all" && vm.power_state !== filters.power) {
        return false;
      }
      if (filters.endpoint && vm.endpoint_id !== filters.endpoint) {
        return false;
      }
      if (filters.host && vm.host_id !== filters.host) {
        return false;
      }
      if (filters.query) {
        const needle = filters.query.toLowerCase();
        const haystack = [
          vm.name,
          vm.guest_os ?? "",
          vm.host_name ?? "",
          vm.endpoint_name ?? "",
          vm.ip_address ?? "",
          vm.datastores.join(" "),
          vm.networks.join(" ")
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }, [virtualMachines, filters]);

  const uniqueHosts = useMemo(() => {
    const map = new Map<string, string>();
    hosts.forEach((host) => map.set(host.id, host.name));
    filteredVms.forEach((vm) => {
      if (vm.host_id && vm.host_name) {
        map.set(vm.host_id, vm.host_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [hosts, filteredVms]);

  const formatMemoryMb = (value?: number | null) => {
    if (!value) {
      return "--";
    }
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} GB`;
    }
    return `${value} MB`;
  };

  const formatStorageGb = (value?: number | null) => {
    if (value === undefined || value === null) {
      return "--";
    }
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} TB`;
    }
    return `${value.toFixed(1)} GB`;
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) {
      return "Unknown";
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

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-5 shadow-inner shadow-black/20">
          <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Virtual Machine Center</h2>
              <p className="text-sm text-slate-300">Monitor guest workloads, filter by health, and explore detailed telemetry.</p>
            </div>
            <div className="rounded-full border border-primary-500/40 px-4 py-1 text-xs font-medium uppercase tracking-[0.3em] text-primary-200">
              VM Insights
            </div>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Total VMs</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">{summary.total || "--"}</p>
              <p className="text-xs text-slate-500">Across all registered collectors</p>
            </div>
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Power state</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">{summary.poweredOn || 0}</p>
              <p className="text-xs text-slate-500">Powered on • {summary.poweredOff} off • {summary.suspended} suspended</p>
            </div>
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Average memory usage</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">
                {summary.avgMemory !== null ? formatMemoryMb(summary.avgMemory) : "--"}
              </p>
              <p className="text-xs text-slate-500">Based on latest poll snapshot</p>
            </div>
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Average storage usage</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">
                {summary.avgStorage !== null ? formatStorageGb(summary.avgStorage) : "--"}
              </p>
              <p className="text-xs text-slate-500">Used capacity per VM</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 md:flex-row">
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="vm-query">
                  Search
                </label>
                <input
                  id="vm-query"
                  type="search"
                  value={filters.query}
                  onChange={(event) => setFilters((prev) => ({ ...prev, query: event.currentTarget.value }))}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  placeholder="Search by VM, host, OS, or network"
                />
              </div>
              <div className="md:w-48">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="vm-power-filter">
                  Power state
                </label>
                <select
                  id="vm-power-filter"
                  value={filters.power}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, power: event.currentTarget.value as Filters["power"] }))
                  }
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="powered_on">Powered on</option>
                  <option value="powered_off">Powered off</option>
                  <option value="suspended">Suspended</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>
              <div className="md:w-52">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="vm-endpoint-filter">
                  Collector
                </label>
                <select
                  id="vm-endpoint-filter"
                  value={filters.endpoint}
                  onChange={(event) => setFilters((prev) => ({ ...prev, endpoint: event.currentTarget.value }))}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="">All collectors</option>
                  {endpoints.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.name || endpoint.address}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:w-52">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="vm-host-filter">
                  Host
                </label>
                <select
                  id="vm-host-filter"
                  value={filters.host}
                  onChange={(event) => setFilters((prev) => ({ ...prev, host: event.currentTarget.value }))}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="">All hosts</option>
                  {uniqueHosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              className="self-start rounded-md border border-brand-700 bg-brand-800 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
              onClick={() => {
                setFilters({ ...initialFilters });
                setSelectedVm(null);
              }}
            >
              Reset filters
            </button>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[2fr,1fr]">
          <div className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Virtual machines</h3>
              {isLoading && <span className="text-xs text-slate-400">Loading…</span>}
            </div>
            {loadError && <p className="mt-4 text-sm text-rose-300">{loadError}</p>}
            {!isLoading && !loadError && filteredVms.length === 0 && (
              <p className="mt-4 text-sm text-slate-400">No virtual machines match your filters.</p>
            )}
            {!isLoading && !loadError && filteredVms.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 text-left">VM</th>
                      <th className="px-3 text-left">Host</th>
                      <th className="px-3 text-left">Collector</th>
                      <th className="px-3 text-left">Power</th>
                      <th className="px-3 text-left">vCPU</th>
                      <th className="px-3 text-left">Memory</th>
                      <th className="px-3 text-left">Storage</th>
                      <th className="px-3 text-left">Networks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVms.map((vm) => (
                      <tr
                        key={vm.id}
                        className={`cursor-pointer rounded-lg border border-brand-800/70 bg-brand-900/80 transition hover:border-primary-500/60 hover:bg-brand-800/60 ${
                          selectedVm?.id === vm.id ? "ring-1 ring-primary-500" : ""
                        }`}
                        onClick={() => setSelectedVm(vm)}
                      >
                        <td className="px-3 py-2 align-top">
                          <div className="font-semibold text-slate-100">{vm.name}</div>
                          <div className="text-xs text-slate-400">{vm.guest_os ?? "Unknown OS"}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-slate-300">{vm.host_name ?? "Unassigned"}</td>
                        <td className="px-3 py-2 align-top text-xs text-slate-300">{vm.endpoint_name}</td>
                        <td className="px-3 py-2 align-top">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${
                              powerStateColors[vm.power_state]
                            }`}
                          >
                            {powerStateLabels[vm.power_state]}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-slate-300">{vm.cpu_count ?? "--"}</td>
                        <td className="px-3 py-2 align-top text-xs text-slate-300">{formatMemoryMb(vm.memory_mb)}</td>
                        <td className="px-3 py-2 align-top text-xs text-slate-300">{formatStorageGb(vm.used_storage_gb)}</td>
                        <td className="px-3 py-2 align-top text-xs text-slate-300">
                          {vm.networks.length ? vm.networks.join(", ") : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
            {!selectedVm && (
              <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-400">
                <p>Select a virtual machine to inspect detailed telemetry.</p>
              </div>
            )}
            {selectedVm && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">{selectedVm.name}</h3>
                  <p className="text-xs text-slate-400">{selectedVm.guest_os ?? "Unknown guest OS"}</p>
                </div>
                <div className="rounded-md border border-brand-800 bg-brand-900/70 p-3 text-xs text-slate-300">
                  <dl className="space-y-2">
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Collector</dt>
                      <dd>{selectedVm.endpoint_name}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Host</dt>
                      <dd>{selectedVm.host_name ?? "Unassigned"}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Power</dt>
                      <dd>{powerStateLabels[selectedVm.power_state]}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">vCPU</dt>
                      <dd>{selectedVm.cpu_count ?? "--"}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Memory</dt>
                      <dd>{formatMemoryMb(selectedVm.memory_mb)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Storage</dt>
                      <dd>{formatStorageGb(selectedVm.used_storage_gb)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Provisioned</dt>
                      <dd>{formatStorageGb(selectedVm.provisioned_storage_gb)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Tools status</dt>
                      <dd>{selectedVm.tools_status ?? "Unknown"}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">IP address</dt>
                      <dd>{selectedVm.ip_address ?? "--"}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-400">Last seen</dt>
                      <dd>{formatDateTime(selectedVm.last_seen_at)}</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Datastores</h4>
                  <p className="mt-1 text-xs text-slate-300">
                    {selectedVm.datastores.length ? selectedVm.datastores.join(", ") : "No datastores reported"}
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Networks</h4>
                  <p className="mt-1 text-xs text-slate-300">
                    {selectedVm.networks.length ? selectedVm.networks.join(", ") : "No networks reported"}
                  </p>
                </div>
                <div className="rounded-md border border-primary-500/40 bg-primary-500/10 p-3 text-xs text-primary-100">
                  <p>Future automation hooks (console launch, remediation playbooks) will appear here.</p>
                </div>
              </div>
            )}
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
