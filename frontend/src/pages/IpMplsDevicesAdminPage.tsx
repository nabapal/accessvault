import { FormEvent, Fragment, useEffect, useState } from "react";

import { Dialog, Transition } from "@headlessui/react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/toast";
import {
  createIpMplsDevice,
  deleteIpMplsDevice,
  fetchIpMplsDevices,
  syncIpMplsDevice,
  testIpMplsDevice,
  updateIpMplsDevice,
  type IpMplsConnectivityResult,
  type IpMplsDeviceUpdate
} from "@/services/ipmpls";
import { parseApiDate } from "@/utils/datetime";
import { IpMplsDevice, IpMplsDeviceCreate, IpMplsPlatform } from "@/types";

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

const emptyForm: IpMplsDeviceCreate = {
  name: "",
  mgmt_ip: "",
  port: 22,
  platform: "iosxr",
  username: "",
  password: "",
  enable: "",
  poll_interval_seconds: 900
};

export function IpMplsDevicesAdminPage() {
  const [devices, setDevices] = useState<IpMplsDevice[]>([]);
  const [form, setForm] = useState<IpMplsDeviceCreate>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, IpMplsConnectivityResult>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [editingDevice, setEditingDevice] = useState<IpMplsDevice | null>(null);
  const [editForm, setEditForm] = useState<IpMplsDeviceUpdate>({});
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const load = async () => {
    try {
      const page = await fetchIpMplsDevices({ pageSize: 200 });
      setDevices(page.items);
    } catch (err) {
      console.error("Failed to load devices", err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const created = await createIpMplsDevice({ ...form, port: Number(form.port) || 22 });
      setMessage(`Registered ${created.name}. Running first sync…`);
      toast.success("Device registered", `${created.name} added. Running first sync…`);
      setForm(emptyForm);
      await load();
      try {
        const res = await syncIpMplsDevice(created.id);
        setMessage(
          res.success
            ? `Registered ${created.name} — collected ${res.interfaces} interfaces, ${res.modules} modules.`
            : `Registered ${created.name}, but first sync failed: ${res.message}`
        );
        if (res.success) {
          toast.success("First sync complete", `${res.interfaces} interfaces, ${res.modules} modules collected.`);
        } else {
          toast.warning("First sync failed", res.message ?? undefined);
        }
        await load();
      } catch {
        setMessage(`Registered ${created.name}. Trigger a sync from the list when ready.`);
        toast.warning("First sync didn't run", "Trigger a sync from the list when ready.");
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Failed to register device.");
      toast.error("Registration failed", detail || undefined);
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await syncIpMplsDevice(id);
      setMessage(res.success ? `Synced: ${res.interfaces} interfaces, ${res.modules} modules.` : `Sync failed: ${res.message}`);
      if (res.success) {
        toast.success("Sync complete", `${res.interfaces} interfaces, ${res.modules} modules collected.`);
      } else {
        toast.error("Sync failed", res.message ?? undefined);
      }
      await load();
    } catch {
      setError("Sync request failed.");
      toast.error("Sync request failed", "Could not reach the device sync endpoint.");
    } finally {
      setSyncingId(null);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const result = await testIpMplsDevice(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.reachable) {
        toast.success("Connection successful", result.hostname ?? undefined);
      } else {
        toast.error("Connection failed", result.message ?? undefined);
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const msg = detail || "Test request failed.";
      setTestErrors((prev) => ({ ...prev, [id]: msg }));
      toast.error("Test failed", msg);
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete device ${name}? This removes its collected inventory.`)) return;
    try {
      await deleteIpMplsDevice(id);
      toast.success("Device deleted", `${name} and its collected inventory were removed.`);
      await load();
    } catch {
      setError("Delete failed.");
      toast.error("Delete failed", `Could not delete ${name}.`);
    }
  };

  const openEdit = (device: IpMplsDevice) => {
    setEditingDevice(device);
    setEditForm({
      name: device.name,
      mgmt_ip: device.mgmt_ip,
      port: device.port,
      platform: device.platform,
      username: device.username ?? "",
      poll_interval_seconds: device.poll_interval_seconds,
      password: "",
      enable: ""
    });
    setUpdateError(null);
  };

  const closeEdit = () => {
    if (isUpdating) return;
    setEditingDevice(null);
    setEditForm({});
    setUpdateError(null);
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingDevice) return;
    setIsUpdating(true);
    setUpdateError(null);
    const payload: IpMplsDeviceUpdate = { ...editForm };
    if (typeof payload.port !== "undefined") {
      payload.port = Number(payload.port) || 22;
    }
    if (typeof payload.poll_interval_seconds !== "undefined") {
      payload.poll_interval_seconds = Number(payload.poll_interval_seconds) || 900;
    }
    if (!payload.password || !payload.password.trim()) {
      delete payload.password;
    }
    if (!payload.enable || !payload.enable.trim()) {
      delete payload.enable;
    }
    try {
      const updated = await updateIpMplsDevice(editingDevice.id, payload);
      const label = updated.hostname || updated.name;
      toast.success("Device updated", label);
      setMessage(`Updated ${label}.`);
      setError(null);
      setEditingDevice(null);
      setEditForm({});
      await load();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const msg = detail || "Failed to update device.";
      setUpdateError(msg);
      toast.error("Update failed", msg);
    } finally {
      setIsUpdating(false);
    }
  };

  const field = "w-full rounded-md border border-brand-700 bg-brand-900 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="IP-MPLS Devices — Admin"
          description="Register Cisco IOS-XE/XR routers for SSH collection."
        />

        {message ? <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</div> : null}
        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}

        <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Register device</h2>
          <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Name</label>
              <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Management IP</label>
              <input className={field} value={form.mgmt_ip} onChange={(e) => setForm({ ...form, mgmt_ip: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Platform</label>
              <select
                className={field}
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value as IpMplsPlatform })}
              >
                <option value="iosxr">IOS-XR</option>
                <option value="iosxe">IOS-XE</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Username</label>
              <input className={field} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Password</label>
              <input type="password" className={field} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Enable secret (optional)</label>
              <input type="password" className={field} value={form.enable} onChange={(e) => setForm({ ...form, enable: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">SSH port</label>
              <input type="number" className={field} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Poll interval (s)</label>
              <input type="number" className={field} value={form.poll_interval_seconds} onChange={(e) => setForm({ ...form, poll_interval_seconds: Number(e.target.value) })} />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md border border-primary-500 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Registering…" : "Register + Sync"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="border-b border-brand-800/70 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Registered devices ({devices.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Mgmt IP</th>
                  <th className="px-4 py-3 text-left">Platform</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Last Poll</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {devices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No devices registered yet.</td>
                  </tr>
                ) : (
                  devices.map((d) => {
                    const testResult = testResults[d.id];
                    const testError = testErrors[d.id];
                    return (
                      <tr key={d.id} className="align-top hover:bg-brand-800/40">
                        <td className="px-4 py-3 text-slate-100">{d.hostname || d.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-100">{d.mgmt_ip}</td>
                        <td className="px-4 py-3 text-slate-100">{d.platform}</td>
                        <td className="px-4 py-3 text-slate-100">
                          {d.status}
                          {d.last_error ? <div className="text-xs text-rose-300">{d.last_error}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-100">{formatDateTime(d.last_polled_at)}</td>
                        <td className="px-4 py-3 text-xs text-slate-300">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(d)}
                              className="rounded-md border border-brand-700 bg-brand-900 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-primary-500 hover:text-white"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(d.id, d.hostname || d.name)}
                              className="rounded-md border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTest(d.id)}
                              disabled={testingId === d.id}
                              className="rounded-md border border-brand-700 bg-brand-800 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white disabled:opacity-50"
                            >
                              {testingId === d.id ? "Testing…" : "Test connection"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSync(d.id)}
                              disabled={syncingId === d.id}
                              className="rounded-md border border-primary-500/40 bg-primary-500/20 px-3 py-1 text-xs font-medium text-primary-100 transition hover:bg-primary-500/30 disabled:opacity-50"
                            >
                              {syncingId === d.id ? "Syncing…" : "Sync now"}
                            </button>
                          </div>
                          {testResult ? (
                            <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                              <div className={`font-medium ${testResult.reachable ? "text-emerald-300" : "text-rose-300"}`}>
                                {testResult.reachable ? "Reachable" : "Failed"}
                              </div>
                              {testResult.hostname ? <div>Hostname: {testResult.hostname}</div> : null}
                              {testResult.message ? (
                                <div className={testResult.reachable ? "" : "text-rose-300"}>{testResult.message}</div>
                              ) : null}
                              {testResult.checked_at ? (
                                <div className="text-slate-500">Checked: {formatDateTime(testResult.checked_at)}</div>
                              ) : null}
                            </div>
                          ) : null}
                          {testError ? <div className="mt-3 text-[11px] text-rose-300">{testError}</div> : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Transition.Root show={Boolean(editingDevice)} as={Fragment} appear>
        <Dialog as="div" className="relative z-50" onClose={closeEdit}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/70" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-lg border border-brand-800 bg-brand-900/95 p-6 shadow-xl transition-all">
                  <Dialog.Title className="text-lg font-semibold text-slate-100">Edit device</Dialog.Title>
                  <p className="mt-1 text-sm text-slate-400">Update connection details, credentials, or polling settings.</p>
                  <form className="mt-4 space-y-4" onSubmit={handleUpdate}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Name</label>
                        <input className={field} value={editForm.name ?? ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Management IP</label>
                        <input className={field} value={editForm.mgmt_ip ?? ""} onChange={(e) => setEditForm({ ...editForm, mgmt_ip: e.target.value })} required />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Platform</label>
                        <select
                          className={field}
                          value={editForm.platform ?? "iosxr"}
                          onChange={(e) => setEditForm({ ...editForm, platform: e.target.value as IpMplsPlatform })}
                        >
                          <option value="iosxr">IOS-XR</option>
                          <option value="iosxe">IOS-XE</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Username</label>
                        <input className={field} value={editForm.username ?? ""} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} required />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Password</label>
                        <input
                          type="password"
                          className={field}
                          value={editForm.password ?? ""}
                          placeholder="Leave blank to keep current secret"
                          onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Enable secret</label>
                        <input
                          type="password"
                          className={field}
                          value={editForm.enable ?? ""}
                          placeholder="Leave blank to keep current"
                          onChange={(e) => setEditForm({ ...editForm, enable: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">SSH port</label>
                        <input type="number" className={field} value={editForm.port ?? 22} onChange={(e) => setEditForm({ ...editForm, port: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Poll interval (s)</label>
                        <input
                          type="number"
                          className={field}
                          value={editForm.poll_interval_seconds ?? 900}
                          onChange={(e) => setEditForm({ ...editForm, poll_interval_seconds: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    {updateError ? <p className="text-sm text-rose-300">{updateError}</p> : null}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeEdit}
                        disabled={isUpdating}
                        className="rounded-md border border-brand-700 bg-brand-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isUpdating}
                        className="rounded-md border border-primary-500 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isUpdating ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    </AppShell>
  );
}
