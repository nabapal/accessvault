import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { fetchIpMplsDevice, fetchIpMplsDeviceInterfaces, fetchIpMplsDeviceModules } from "@/services/ipmpls";
import { parseApiDate } from "@/utils/datetime";
import { IpMplsDevice, IpMplsInterface, IpMplsModule } from "@/types";

const formatDateTime = (value?: string | null) => {
  if (!value) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(
      parseApiDate(value)
    );
  } catch {
    return value;
  }
};

const formatUptime = (seconds?: number | null) => {
  if (!seconds) return "--";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
};

const Fact = ({ label, value }: { label: string; value?: string | null }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="text-slate-100">{value ?? "--"}</dd>
  </div>
);

export function IpMplsDeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<IpMplsDevice | null>(null);
  const [interfaces, setInterfaces] = useState<IpMplsInterface[]>([]);
  const [modules, setModules] = useState<IpMplsModule[]>([]);
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) {
      navigate("/ipmpls/devices", { replace: true });
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const [d, ifs, mods] = await Promise.all([
          fetchIpMplsDevice(deviceId),
          fetchIpMplsDeviceInterfaces(deviceId),
          fetchIpMplsDeviceModules(deviceId)
        ]);
        if (cancelled) return;
        setDevice(d);
        setInterfaces(ifs);
        setModules(mods);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load device detail", err);
          setError("Unable to load device detail. Please retry.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [deviceId, navigate]);

  const filteredInterfaces = useMemo(() => {
    if (!filter) return interfaces;
    const q = filter.toLowerCase();
    return interfaces.filter((i) =>
      [i.name, i.description, i.ip_address, i.vrf, i.admin_state, i.oper_state]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [interfaces, filter]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <div className="flex items-center gap-3 text-sm text-primary-300">
            <Link to="/ipmpls/devices" className="hover:text-primary-200">IP-MPLS Devices</Link>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300">Device Detail</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-white">
            {device?.hostname || device?.name || (isLoading ? "Loading…" : "Device")}
          </h1>
          {device ? (
            <p className="mt-1 text-sm text-slate-300">
              {device.platform.toUpperCase()} • {device.mgmt_ip} • {device.model ?? "--"}
            </p>
          ) : null}
        </header>

        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        {device ? (
          <>
            <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
              <h2 className="text-sm font-semibold text-slate-100">General</h2>
              <dl className="mt-3 grid gap-x-4 gap-y-3 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Hostname" value={device.hostname} />
                <Fact label="Management IP" value={device.mgmt_ip} />
                <Fact label="Model" value={device.model} />
                <Fact label="Serial" value={device.serial} />
                <Fact label="OS Version" value={device.os_version} />
                <Fact label="Uptime" value={device.uptime_text ?? formatUptime(device.uptime_seconds)} />
                <Fact label="Role" value={device.role} />
                <Fact label="Status" value={device.status} />
                <Fact label="Last Poll" value={formatDateTime(device.last_polled_at)} />
                <Fact label="Site" value={device.site_name} />
                <Fact label="Rack" value={device.rack_location} />
              </dl>
              {device.last_error ? (
                <p className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
                  Last error: {device.last_error}
                </p>
              ) : null}
            </section>

            <section className="rounded-lg border border-brand-700 bg-brand-900/60">
              <div className="border-b border-brand-800/70 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-100">Hardware Inventory ({modules.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                  <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Description</th>
                      <th className="px-4 py-3 text-left">PID</th>
                      <th className="px-4 py-3 text-left">Serial</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/60 text-slate-200">
                    {modules.map((m) => (
                      <tr key={m.id} className="hover:bg-brand-800/40">
                        <td className="px-4 py-3 text-slate-100">{m.name ?? "--"}</td>
                        <td className="px-4 py-3 text-slate-300">{m.description ?? "--"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-100">{m.pid ?? "--"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{m.serial ?? "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-brand-700 bg-brand-900/60">
              <div className="flex flex-col gap-3 border-b border-brand-800/70 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-sm font-semibold text-slate-100">Interfaces ({interfaces.length})</h2>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name, IP, VRF, state..."
                  className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 md:w-72"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                  <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left">Interface</th>
                      <th className="px-4 py-3 text-left">Admin</th>
                      <th className="px-4 py-3 text-left">Oper</th>
                      <th className="px-4 py-3 text-left">IP Address</th>
                      <th className="px-4 py-3 text-left">VRF</th>
                      <th className="px-4 py-3 text-left">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/60 text-slate-200">
                    {filteredInterfaces.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-4 text-center text-sm text-slate-400">No interfaces match.</td>
                      </tr>
                    ) : (
                      filteredInterfaces.map((i) => (
                        <tr key={i.id} className="hover:bg-brand-800/40">
                          <td className="px-4 py-3 font-mono text-xs text-white">{i.name}</td>
                          <td className="px-4 py-3 text-slate-100">{i.admin_state ?? "--"}</td>
                          <td className="px-4 py-3 text-slate-100">{i.oper_state ?? "--"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-100">{i.ip_address ?? "--"}</td>
                          <td className="px-4 py-3 text-slate-100">{i.vrf ?? "--"}</td>
                          <td className="px-4 py-3 text-slate-300">{i.description ?? "--"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
