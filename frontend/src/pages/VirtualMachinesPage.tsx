import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ServerStackIcon } from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
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

const powerStateLabels: Record<InventoryPowerState, string> = {
  powered_on: "Powered On",
  powered_off: "Powered Off",
  suspended: "Suspended",
  unknown: "Unknown"
};

const powerStateBadge: Record<InventoryPowerState, string> = {
  powered_on: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  powered_off: "border-slate-500/50 bg-slate-500/10 text-slate-200",
  suspended: "border-amber-500/50 bg-amber-500/10 text-amber-200",
  unknown: "border-slate-500/50 bg-slate-500/10 text-slate-200"
};

type PowerFilter = "all" | InventoryPowerState;

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return value.toLocaleString();
};

const formatGigabytes = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "--";
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} TB`;
  }
  return `${value.toFixed(1)} GB`;
};

const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.min(100, Math.max(0, Math.round(value)))}%`;
};

export function VirtualMachinesPage() {
  const navigate = useNavigate();
  const [virtualMachines, setVirtualMachines] = useState<InventoryVirtualMachine[]>([]);
  const [hosts, setHosts] = useState<InventoryHost[]>([]);
  const [endpoints, setEndpoints] = useState<InventoryEndpoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [hostFilter, setHostFilter] = useState<string>("all");
  const [powerFilter, setPowerFilter] = useState<PowerFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

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
        setError(null);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Unable to load virtual machine inventory";
        setError(message);
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
    setPage(1);
  }, [endpointFilter, hostFilter, powerFilter, searchTerm]);

  const filteredVirtualMachines = useMemo(() => {
    return virtualMachines.filter((vm) => {
      if (endpointFilter !== "all" && vm.endpoint_id !== endpointFilter) {
        return false;
      }
      if (hostFilter !== "all" && vm.host_id !== hostFilter) {
        return false;
      }
      if (powerFilter !== "all" && vm.power_state !== powerFilter) {
        return false;
      }
      if (searchTerm) {
        const needle = searchTerm.toLowerCase();
        const haystack = [
          vm.name,
          vm.guest_os ?? "",
          vm.endpoint_name ?? "",
          vm.host_name ?? "",
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
  }, [endpointFilter, hostFilter, powerFilter, searchTerm, virtualMachines]);

  const totalVmCount = filteredVirtualMachines.length;
  const totalPages = totalVmCount > 0 ? Math.ceil(totalVmCount / pageSize) : 1;

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedVirtualMachines = useMemo(() => {
    if (!totalVmCount) {
      return [];
    }
    const start = (page - 1) * pageSize;
    return filteredVirtualMachines.slice(start, start + pageSize);
  }, [filteredVirtualMachines, page, pageSize, totalVmCount]);

  const pageStart = totalVmCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = totalVmCount === 0 ? 0 : Math.min(page * pageSize, totalVmCount);
  const canGoPrev = page > 1;
  const canGoNext = totalVmCount > 0 && page < totalPages;

  const summary = useMemo(() => {
    const total = filteredVirtualMachines.length;
    const poweredOn = filteredVirtualMachines.filter((vm) => vm.power_state === "powered_on").length;
    const poweredOff = filteredVirtualMachines.filter((vm) => vm.power_state === "powered_off").length;
    const suspended = filteredVirtualMachines.filter((vm) => vm.power_state === "suspended").length;

    const average = (samples: number[]): number | null => {
      if (!samples.length) {
        return null;
      }
      return samples.reduce((acc, value) => acc + value, 0) / samples.length;
    };

    const cpuSamples = filteredVirtualMachines
      .map((vm) => {
        if (!vm.cpu_count || vm.cpu_count <= 0 || !vm.cpu_usage_mhz) {
          return null;
        }
        return (vm.cpu_usage_mhz / (vm.cpu_count * 2500)) * 100;
      })
      .filter((value): value is number => value !== null && !Number.isNaN(value));

    const memorySamples = filteredVirtualMachines
      .map((vm) => {
        if (!vm.memory_mb || vm.memory_mb <= 0 || !vm.memory_usage_mb) {
          return null;
        }
        return (vm.memory_usage_mb / vm.memory_mb) * 100;
      })
      .filter((value): value is number => value !== null && !Number.isNaN(value));

    const storageSamples = filteredVirtualMachines
      .map((vm) => {
        if (!vm.provisioned_storage_gb || vm.provisioned_storage_gb <= 0 || !vm.used_storage_gb) {
          return null;
        }
        return (vm.used_storage_gb / vm.provisioned_storage_gb) * 100;
      })
      .filter((value): value is number => value !== null && !Number.isNaN(value));

    return {
      total,
      poweredOn,
      poweredOff,
      suspended,
      avgCpu: average(cpuSamples),
      avgMemory: average(memorySamples),
      avgStorage: average(storageSamples)
    };
  }, [filteredVirtualMachines]);

  const uniqueHosts = useMemo(() => {
    const map = new Map<string, string>();
    hosts.forEach((host) => map.set(host.id, host.name));
    filteredVirtualMachines.forEach((vm) => {
      if (vm.host_id && vm.host_name) {
        map.set(vm.host_id, vm.host_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [filteredVirtualMachines, hosts]);

  const openDetails = (vmId: string) => {
    navigate(`/inventory/virtual-machines/${vmId}`);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-5 shadow-inner shadow-black/20">
          <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Virtual Machine Center</h2>
              <p className="text-sm text-slate-300">Inspect workload performance and drill into guest telemetry on demand.</p>
            </div>
            <div className="rounded-full border border-primary-500/40 px-4 py-1 text-xs font-medium uppercase tracking-[0.3em] text-primary-200">
              VM Insights
            </div>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Total VMs</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">{summary.total || "--"}</p>
              <p className="text-xs text-slate-500">Matching current filters</p>
            </div>
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Power Mix</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">{summary.poweredOn}</p>
              <p className="text-xs text-slate-500">
                Powered on • {summary.poweredOff} off • {summary.suspended} suspended
              </p>
            </div>
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Average CPU</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">{formatPercent(summary.avgCpu)}</p>
              <p className="text-xs text-slate-500">Across filtered workloads</p>
            </div>
            <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Average Memory</p>
              <p className="mt-2 text-2xl font-semibold text-primary-100">{formatPercent(summary.avgMemory)}</p>
              <p className="text-xs text-slate-500">Based on latest poll</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 md:flex-row">
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="vm-search">
                  Search
                </label>
                <input
                  id="vm-search"
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.currentTarget.value)}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  placeholder="Search by VM, host, OS, network, or IP"
                />
              </div>
              <div className="md:w-48">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="vm-power-filter">
                  Power state
                </label>
                <select
                  id="vm-power-filter"
                  value={powerFilter}
                  onChange={(event) => setPowerFilter(event.currentTarget.value as PowerFilter)}
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
                  value={endpointFilter}
                  onChange={(event) => setEndpointFilter(event.currentTarget.value)}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="all">All collectors</option>
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
                  value={hostFilter}
                  onChange={(event) => setHostFilter(event.currentTarget.value)}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                >
                  <option value="all">All hosts</option>
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
                setEndpointFilter("all");
                setHostFilter("all");
                setPowerFilter("all");
                setSearchTerm("");
              }}
            >
              Reset filters
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Virtual machines</h3>
          </div>
          {isLoading && (
            <div className="mt-4">
              <TableSkeleton rows={6} cols={7} />
            </div>
          )}
          {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
          {!isLoading && !error && filteredVirtualMachines.length === 0 && (
            <div className="mt-4">
              <EmptyState
                icon={ServerStackIcon}
                title="No virtual machines match your filters"
                description="Adjust the filters above, or wait for the next collector poll to refresh VM inventory."
              />
            </div>
          )}
          {!isLoading && !error && filteredVirtualMachines.length > 0 && (
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
                  {paginatedVirtualMachines.map((vm) => {
                    const cpuPercent = vm.cpu_count && vm.cpu_usage_mhz ? (vm.cpu_usage_mhz / (vm.cpu_count * 2500)) * 100 : null;
                    const memoryPercent = vm.memory_mb && vm.memory_usage_mb ? (vm.memory_usage_mb / vm.memory_mb) * 100 : null;
                    const storagePercent =
                      vm.provisioned_storage_gb && vm.used_storage_gb
                        ? (vm.used_storage_gb / vm.provisioned_storage_gb) * 100
                        : null;
                    return (
                      <tr
                        key={vm.id}
                        className="cursor-pointer rounded-lg border border-brand-800/70 bg-brand-900/80 transition hover:border-primary-500/60 hover:bg-brand-800/60"
                        onClick={() => openDetails(vm.id)}
                      >
                        <td className="px-3 py-3 align-top">
                          <div className="text-sm font-semibold text-slate-100">{vm.name}</div>
                          <div className="text-xs text-slate-400">{vm.guest_os ?? "Unknown OS"}</div>
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-slate-300">
                          <div>{vm.host_name ?? "Unassigned"}</div>
                          <div className="text-slate-500">{vm.endpoint_name}</div>
                          {vm.ip_address && <div className="mt-1 text-slate-500">IP: {vm.ip_address}</div>}
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-slate-300">{vm.endpoint_name}</td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${powerStateBadge[vm.power_state]}`}
                          >
                            {powerStateLabels[vm.power_state]}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-slate-300">
                          <div>vCPU: {formatNumber(vm.cpu_count)}</div>
                          <div>Mem: {formatNumber(vm.memory_mb)} MB</div>
                          <div>Disk: {formatGigabytes(vm.provisioned_storage_gb)}</div>
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-slate-300">
                          <div>CPU usage: {formatPercent(cpuPercent)}</div>
                          <div>Memory usage: {formatPercent(memoryPercent)}</div>
                          <div>Storage usage: {formatPercent(storagePercent)}</div>
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-slate-300">
                          <div>{formatGigabytes(vm.used_storage_gb)} used</div>
                          <div className="text-slate-500">Provisioned {formatGigabytes(vm.provisioned_storage_gb)}</div>
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-slate-300">
                          <div className="flex flex-wrap gap-1">
                            {vm.networks.length === 0 && <span className="text-slate-500">No networks</span>}
                            {vm.networks.map((network) => (
                              <span
                                key={network}
                                className="rounded border border-brand-700/60 bg-brand-800/60 px-2 py-0.5 text-[11px] text-slate-200"
                              >
                                {network}
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {vm.datastores.map((datastore) => (
                              <span
                                key={datastore}
                                className="rounded border border-primary-500/40 bg-primary-500/10 px-2 py-0.5 text-[11px] text-primary-100"
                              >
                                {datastore}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">
                    Showing {pageStart}-{pageEnd} of {totalVmCount} virtual machines
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Rows</span>
                      <select
                        value={pageSize}
                        onChange={(event) => {
                          setPageSize(Number(event.currentTarget.value));
                          setPage(1);
                        }}
                        className="rounded border border-brand-700 bg-brand-900/80 px-2 py-1 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={!canGoPrev}
                      >
                        Previous
                      </button>
                      <span>
                        Page {page} of {totalPages}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-brand-700 bg-brand-900/80 px-3 py-1 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={!canGoNext}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

