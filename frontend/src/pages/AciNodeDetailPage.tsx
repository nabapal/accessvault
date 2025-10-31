import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { fetchAciFabricNodeDetail, fetchAciFabricNodeInterfaces } from "@/services/aci";
import { AciFabricNodeDetail, AciFabricNodeInterface } from "@/types";

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "--";
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

const formatPercent = (value?: number | null, fractionDigits = 1) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(fractionDigits)}%`;
};

const formatGigabytesFromKilobytes = (value?: number | null) => {
  if (value === undefined || value === null) {
    return "--";
  }
  const gb = value / 1024 / 1024;
  if (!Number.isFinite(gb)) {
    return "--";
  }
  return `${gb.toFixed(1)} GB`;
};

const formatTemperature = (value?: number | null) => {
  if (value === undefined || value === null) {
    return "--";
  }
  return `${value.toFixed(1)} °C`;
};

const formatListValue = (value?: string | null) => {
  if (!value) {
    return "--";
  }
  return value;
};

export function AciNodeDetailPage() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AciFabricNodeDetail | null>(null);
  const [interfaces, setInterfaces] = useState<AciFabricNodeInterface[]>([]);
  const [interfaceFilter, setInterfaceFilter] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) {
      navigate("/telco/aci", { replace: true });
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const [detailResponse, interfacesResponse] = await Promise.all([
          fetchAciFabricNodeDetail(nodeId),
          fetchAciFabricNodeInterfaces(nodeId)
        ]);
        setDetail(detailResponse);
        setInterfaces(interfacesResponse);
        setError(null);
      } catch (err) {
        console.error("Failed to load node detail", err);
        setDetail(null);
        setInterfaces([]);
        setError("Unable to load node detail. Please retry.");
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [nodeId, navigate]);

  const healthSamples = detail?.health.samples ?? [];
  const shortTermHealth = useMemo(() => {
    if (healthSamples.length === 0) {
      return null;
    }
    const preferred = healthSamples.find((sample) => sample.window === "15min");
    return preferred ?? healthSamples[0];
  }, [healthSamples]);

  const cpuStats = detail?.resources.cpu ?? null;
  const memoryStats = detail?.resources.memory ?? null;

  const filteredInterfaces = useMemo(() => {
    if (!interfaceFilter) {
      return interfaces;
    }
    const term = interfaceFilter.toLowerCase();
    return interfaces.filter((item) => {
      const transceiver = item.transceiver ?? {};
      const candidates = [
        item.name,
        item.description,
        item.oper_state,
        item.oper_speed,
        item.vlan_list,
        item.port_channel_name,
        transceiver.product_id,
        transceiver.type,
        transceiver.vendor,
        transceiver.serial,
        transceiver.state
      ].filter(Boolean) as string[];
      return candidates.some((candidate) => candidate.toLowerCase().includes(term));
    });
  }, [interfaces, interfaceFilter]);

  const portChannelCount = detail?.port_channels.length ?? 0;
  const interfaceCount = interfaces.length;

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-primary-300">
              <Link to="/telco/aci" className="hover:text-primary-200">
                Cisco ACI Fabric Inventory
              </Link>
              <span className="text-slate-600">/</span>
              <span className="text-slate-300">Node Detail</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-white">
              {detail?.node.name ?? (isLoading ? "Loading…" : "Fabric Node Detail")}
            </h1>
            {detail ? (
              <p className="mt-1 text-sm text-slate-300">
                {detail.node.role.toUpperCase()} • {detail.node.fabric_name ?? "Unassigned Fabric"} • {detail.node.fabric_ip ?? "--"}
              </p>
            ) : null}
          </div>
          <div className="flex gap-3 text-sm">
            <Link
              to="/telco/aci"
              className="inline-flex items-center justify-center rounded-md border border-brand-700 bg-brand-800/60 px-4 py-2 font-medium text-slate-200 transition hover:border-primary-500 hover:text-white"
            >
              Back to Inventory
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded border border-rose-500/60 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : null}

        {isLoading ? (
          <div className="rounded border border-brand-700 bg-brand-900/50 p-6 text-sm text-slate-400">Loading node telemetry…</div>
        ) : null}

        {!isLoading && !detail ? (
          <div className="rounded border border-brand-700 bg-brand-900/50 p-6 text-sm text-slate-400">
            Node detail not available. Trigger a collector run to populate telemetry.
          </div>
        ) : null}

        {detail ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Health Score</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-200">
                  {shortTermHealth?.health_last !== undefined && shortTermHealth?.health_last !== null
                    ? shortTermHealth.health_last.toFixed(0)
                    : "--"}
                </p>
                <p className="mt-1 text-[13px] text-slate-400">
                  Last {shortTermHealth?.window ?? "sample"} health reading
                </p>
              </div>
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">CPU Utilization</p>
                <p className="mt-2 text-2xl font-semibold text-blue-200">{formatPercent(cpuStats?.usage_pct)}</p>
                <p className="mt-1 text-[13px] text-slate-400">
                  Idle {formatPercent(cpuStats?.idle_pct)} • User {formatPercent(cpuStats?.user_pct)}
                </p>
              </div>
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Memory Utilization</p>
                <p className="mt-2 text-2xl font-semibold text-amber-200">{formatPercent(memoryStats?.usage_pct)}</p>
                <p className="mt-1 text-[13px] text-slate-400">
                  {formatGigabytesFromKilobytes(memoryStats?.used_kb)} used of {formatGigabytesFromKilobytes(memoryStats?.total_kb)}
                </p>
              </div>
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Inventory Coverage</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">{interfaceCount} interfaces</p>
                <p className="mt-1 text-[13px] text-slate-400">{portChannelCount} port-channels discovered</p>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
                <h2 className="text-sm font-semibold text-slate-100">General Information</h2>
                <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm text-slate-300 md:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Serial</dt>
                    <dd className="text-slate-100">{detail.node.serial ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Model</dt>
                    <dd className="text-slate-100">{detail.node.model ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Software Version</dt>
                    <dd className="text-slate-100">{detail.node.version ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">System Uptime</dt>
                    <dd className="text-slate-100">{formatListValue(detail.general.uptime)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">In-band Management</dt>
                    <dd className="text-slate-100">{detail.general.inband_address ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Out-of-band Management</dt>
                    <dd className="text-slate-100">{detail.general.oob_address ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Fabric Domain</dt>
                    <dd className="text-slate-100">{detail.general.fabric_domain ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Last Reboot</dt>
                    <dd className="text-slate-100">{formatDateTime(detail.general.last_reboot_at)}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
                <h2 className="text-sm font-semibold text-slate-100">Firmware</h2>
                <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm text-slate-300 md:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Running Version</dt>
                    <dd className="text-slate-100">{detail.firmware?.version ?? detail.node.version ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Description</dt>
                    <dd className="text-slate-100">{detail.firmware?.description ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">BIOS Version</dt>
                    <dd className="text-slate-100">{detail.firmware?.bios_version ?? "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">BIOS Timestamp</dt>
                    <dd className="text-slate-100">{formatDateTime(detail.firmware?.bios_timestamp ?? null)}</dd>
                  </div>
                  <div className="md:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Kickstart Image</dt>
                    <dd className="text-slate-100">{detail.firmware?.kickstart_image ?? "--"}</dd>
                  </div>
                  <div className="md:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">System Image</dt>
                    <dd className="text-slate-100">{detail.firmware?.system_image ?? "--"}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="rounded-lg border border-brand-700 bg-brand-900/60">
              <div className="border-b border-brand-800/70 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-100">Environment Sensors</h2>
                <p className="text-xs text-slate-400">Temperature probes and fan modules reported within the last poll.</p>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Temperature</h3>
                  {detail.environment.temperatures.length === 0 ? (
                    <div className="text-sm text-slate-400">No temperature sensors reported.</div>
                  ) : (
                    <ul className="space-y-2 text-sm text-slate-200">
                      {detail.environment.temperatures.slice(0, 8).map((sensor) => (
                        <li key={sensor.distinguished_name ?? sensor.name} className="rounded border border-brand-800/70 bg-brand-900/50 px-3 py-2">
                          <div className="font-semibold text-slate-100">{sensor.name}</div>
                          <div className="text-xs text-slate-400">{formatTemperature(sensor.value_celsius)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fans</h3>
                  {detail.environment.fans.length === 0 ? (
                    <div className="text-sm text-slate-400">No fan modules reported.</div>
                  ) : (
                    <ul className="space-y-2 text-sm text-slate-200">
                      {detail.environment.fans.slice(0, 8).map((fan) => (
                        <li key={fan.distinguished_name ?? fan.name} className="rounded border border-brand-800/70 bg-brand-900/50 px-3 py-2">
                          <div className="font-semibold text-slate-100">{fan.name}</div>
                          <div className="text-xs text-slate-400">Status: {fan.status ?? "--"}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-brand-700 bg-brand-900/60">
              <div className="border-b border-brand-800/70 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-100">Port Channels</h2>
                <p className="text-xs text-slate-400">Aggregated links and active members discovered on this node.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                  <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left">Port Channel</th>
                      <th className="px-4 py-3 text-left">State</th>
                      <th className="px-4 py-3 text-left">Usage</th>
                      <th className="px-4 py-3 text-left">Members</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/60 text-slate-200">
                    {detail.port_channels.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-4 text-center text-sm text-slate-400">
                          No port channels discovered.
                        </td>
                      </tr>
                    ) : (
                      detail.port_channels.map((channel) => (
                        <tr key={channel.port_channel_id} className="hover:bg-brand-800/40">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-white">{channel.name ?? channel.port_channel_id}</div>
                            <div className="text-xs text-slate-400">ID: {channel.port_channel_id ? channel.port_channel_id.toUpperCase() : "--"}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div>{channel.oper_state ?? "--"}</div>
                            <div className="text-xs text-slate-500">Admin: {channel.admin_state ?? "--"}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div>{channel.usage ?? "--"}</div>
                            <div className="text-xs text-slate-500">Active: {channel.active_ports ?? "--"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-100">
                            {channel.members.length === 0
                              ? "--"
                              : channel.members.map((member) => member.name ?? member.distinguished_name ?? "--").join(", ")}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-brand-700 bg-brand-900/60">
              <div className="border-b border-brand-800/70 px-4 py-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Interfaces</h2>
                    <p className="text-xs text-slate-400">Operational state, speed, VLANs, and port-channel membership.</p>
                  </div>
                  <input
                    type="search"
                    value={interfaceFilter}
                    onChange={(event) => setInterfaceFilter(event.target.value)}
                    placeholder="Filter by name, state, VLAN, port-channel..."
                    className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 md:w-80"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                  <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left">Interface</th>
                      <th className="px-4 py-3 text-left">Admin / Oper</th>
                      <th className="px-4 py-3 text-left">Speed</th>
                      <th className="px-4 py-3 text-left">Transceiver</th>
                      <th className="px-4 py-3 text-left">VLANs</th>
                      <th className="px-4 py-3 text-left">Port Channel</th>
                      <th className="px-4 py-3 text-left">Last Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/60 text-slate-200">
                    {filteredInterfaces.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-4 text-center text-sm text-slate-400">
                          No interfaces match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredInterfaces.map((iface) => (
                        <tr key={iface.id} className="hover:bg-brand-800/40">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-white">{iface.name}</div>
                            <div className="text-xs text-slate-400">{iface.description ?? iface.distinguished_name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div>{iface.admin_state ?? "--"}</div>
                            <div className="text-xs text-slate-500">{iface.oper_state ?? "--"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-100">{iface.oper_speed ?? "--"}</td>
                          <td className="px-4 py-3 text-slate-100">
                            <div>{iface.transceiver?.product_id ?? iface.transceiver?.type ?? "--"}</div>
                            <div className="text-xs text-slate-500">
                              {iface.transceiver?.vendor ?? "--"}
                              {iface.transceiver?.serial ? ` • ${iface.transceiver.serial}` : ""}
                            </div>
                            <div className="text-xs text-slate-500">State: {iface.transceiver?.state ?? "--"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-100">{iface.vlan_list ?? "--"}</td>
                          <td className="px-4 py-3 text-slate-100">{iface.port_channel_name ?? iface.port_channel_id ?? "--"}</td>
                          <td className="px-4 py-3 text-slate-100">{formatDateTime(iface.last_link_change_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-brand-800/70 px-4 py-3 text-xs text-slate-400">
                Showing {filteredInterfaces.length} of {interfaceCount} interfaces
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
