import { Fragment, useEffect, useMemo, useState } from "react";

import { Dialog, Transition } from "@headlessui/react";

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

const formatDateTime = (value?: string | null): string => {
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

export function VirtualMachinesPage() {
  const [virtualMachines, setVirtualMachines] = useState<InventoryVirtualMachine[]>([]);
  const [hosts, setHosts] = useState<InventoryHost[]>([]);
  const [endpoints, setEndpoints] = useState<InventoryEndpoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [hostFilter, setHostFilter] = useState<string>("all");
  const [powerFilter, setPowerFilter] = useState<PowerFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
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
    if (!selectedVmId) {
      return;
    }
    const refreshed = virtualMachines.find((vm) => vm.id === selectedVmId);
    if (!refreshed) {
      setSelectedVmId(null);
      setIsDetailsOpen(false);
    }
  }, [selectedVmId, virtualMachines]);

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

  const selectedVm = useMemo(() => {
    return filteredVirtualMachines.find((vm) => vm.id === selectedVmId) ?? null;
  }, [filteredVirtualMachines, selectedVmId]);

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
    setSelectedVmId(vmId);
    setIsDetailsOpen(true);
  };

  const closeDetails = () => {
    setIsDetailsOpen(false);
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
                setSelectedVmId(null);
              }}
            >
              Reset filters
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Virtual machines</h3>
            {isLoading && <span className="text-xs text-slate-400">Loading…</span>}
          </div>
          {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
          {!isLoading && !error && filteredVirtualMachines.length === 0 && (
            <p className="mt-4 text-sm text-slate-400">No virtual machines match your filters.</p>
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

        <Transition appear show={isDetailsOpen && !!selectedVm} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={closeDetails}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/60" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-6">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-200"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-150"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-xl border border-brand-700 bg-brand-900/95 p-6 text-slate-100 shadow-xl">
                    {selectedVm && (
                      <div className="space-y-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <Dialog.Title className="text-lg font-semibold">{selectedVm.name}</Dialog.Title>
                            <p className="text-sm text-slate-400">{selectedVm.guest_os ?? "Unknown guest OS"}</p>
                          </div>
                          <button
                            type="button"
                            className="rounded-md border border-brand-700 bg-brand-800 px-3 py-1 text-xs font-medium text-slate-200 hover:border-primary-500 hover:bg-brand-700"
                            onClick={closeDetails}
                          >
                            Close
                          </button>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4 text-xs text-slate-300">
                            <h4 className="text-sm font-semibold text-slate-200">Placement</h4>
                            <p className="mt-2">Host: {selectedVm.host_name ?? "Unassigned"}</p>
                            <p>Collector: {selectedVm.endpoint_name}</p>
                            {selectedVm.ip_address && <p>IP: {selectedVm.ip_address}</p>}
                            <p>Power: {powerStateLabels[selectedVm.power_state]}</p>
                          </div>
                          <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4 text-xs text-slate-300">
                            <h4 className="text-sm font-semibold text-slate-200">Resources</h4>
                            <p className="mt-2">vCPU: {formatNumber(selectedVm.cpu_count)}</p>
                            <p>Memory: {formatNumber(selectedVm.memory_mb)} MB</p>
                            <p>Provisioned storage: {formatGigabytes(selectedVm.provisioned_storage_gb)}</p>
                            <p>Used storage: {formatGigabytes(selectedVm.used_storage_gb)}</p>
                          </div>
                        </div>

                        <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4 text-xs text-slate-300">
                          <h4 className="text-sm font-semibold text-slate-200">Utilization</h4>
                          <div className="mt-2 grid gap-3 sm:grid-cols-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-slate-500">CPU usage</p>
                              <p className="text-sm text-primary-100">
                                {formatPercent(
                                  selectedVm.cpu_count && selectedVm.cpu_usage_mhz
                                    ? (selectedVm.cpu_usage_mhz / (selectedVm.cpu_count * 2500)) * 100
                                    : null
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-slate-500">Memory usage</p>
                              <p className="text-sm text-primary-100">
                                {formatPercent(
                                  selectedVm.memory_mb && selectedVm.memory_usage_mb
                                    ? (selectedVm.memory_usage_mb / selectedVm.memory_mb) * 100
                                    : null
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-slate-500">Storage usage</p>
                              <p className="text-sm text-primary-100">
                                {formatPercent(
                                  selectedVm.provisioned_storage_gb && selectedVm.used_storage_gb
                                    ? (selectedVm.used_storage_gb / selectedVm.provisioned_storage_gb) * 100
                                    : null
                                )}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4 text-xs text-slate-300">
                          <h4 className="text-sm font-semibold text-slate-200">Connectivity</h4>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedVm.networks.length ? (
                              selectedVm.networks.map((network) => (
                                <span
                                  key={network}
                                  className="rounded border border-brand-700/60 bg-brand-800/60 px-2 py-0.5 text-[11px] text-slate-200"
                                >
                                  {network}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-500">No networks assigned</span>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedVm.datastores.length ? (
                              selectedVm.datastores.map((datastore) => (
                                <span
                                  key={datastore}
                                  className="rounded border border-primary-500/40 bg-primary-500/10 px-2 py-0.5 text-[11px] text-primary-100"
                                >
                                  {datastore}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-500">No datastores attached</span>
                            )}
                          </div>
                        </div>

                        <div className="rounded-md border border-brand-800 bg-brand-900/70 p-4 text-xs text-slate-300">
                          <h4 className="text-sm font-semibold text-slate-200">Lifecycle</h4>
                          <p className="mt-2">Last updated: {formatDateTime(selectedVm.updated_at)}</p>
                          <p>Last seen: {formatDateTime(selectedVm.last_seen_at)}</p>
                          <p>Tools status: {selectedVm.tools_status ?? "Unknown"}</p>
                        </div>
                      </div>
                    )}
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </div>
    </AppShell>
  );
}

