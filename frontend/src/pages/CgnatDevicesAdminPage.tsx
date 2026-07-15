import { FormEvent, Fragment, useEffect, useState } from "react";

import { Dialog, Transition } from "@headlessui/react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/toast";
import {
  createCgnatDevice,
  deleteCgnatDevice,
  fetchCgnatDevices,
  syncCgnatDevice,
  testCgnatDevice,
  updateCgnatDevice,
  type CgnatDeviceUpdate
} from "@/services/cgnat";
import { parseApiDate } from "@/utils/datetime";
import { CgnatDevice, CgnatDeviceCreate, CgnatVendor } from "@/types";

const fmtDate = (v?: string | null) => {
  if (!v) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(parseApiDate(v));
  } catch {
    return v;
  }
};

const emptyForm: CgnatDeviceCreate = {
  name: "",
  mgmt_ip: "",
  port: 443,
  vendor: "a10",
  verify_ssl: false,
  username: "",
  password: "",
  poll_interval_seconds: 900
};

export function CgnatDevicesAdminPage() {
  const [devices, setDevices] = useState<CgnatDevice[]>([]);
  const [form, setForm] = useState<CgnatDeviceCreate>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<CgnatDevice | null>(null);
  const [editForm, setEditForm] = useState<CgnatDeviceUpdate>({});
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const load = async () => {
    try {
      const page = await fetchCgnatDevices({ pageSize: 200 });
      setDevices(page.items);
    } catch (err) {
      console.error("Failed to load devices", err);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMessage(null); setError(null);
    try {
      const created = await createCgnatDevice({ ...form, port: Number(form.port) || 443 });
      toast.success("Device registered", `${created.name} added. Running first sync…`);
      setForm(emptyForm);
      await load();
      try {
        const res = await syncCgnatDevice(created.id);
        if (res.success) {
          setMessage(`Registered ${created.name} — ${res.pools} pools, ${res.interfaces} interfaces.`);
          toast.success("First sync complete", `${res.pools} pools, ${res.interfaces} interfaces.`);
        } else {
          setMessage(`Registered ${created.name}, but first sync failed: ${res.message}`);
          toast.warning("First sync failed", res.message ?? undefined);
        }
        await load();
      } catch {
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
    setActingId(id);
    try {
      const res = await syncCgnatDevice(id);
      if (res.success) toast.success("Sync complete", `${res.pools} pools, ${res.interfaces} interfaces.`);
      else toast.error("Sync failed", res.message ?? undefined);
      await load();
    } catch {
      toast.error("Sync request failed");
    } finally {
      setActingId(null);
    }
  };

  const handleTest = async (id: string) => {
    setActingId(id);
    try {
      const res = await testCgnatDevice(id);
      if (res.reachable) toast.success("Connection successful", res.hostname ?? undefined);
      else toast.error("Connection failed", res.message ?? undefined);
    } catch {
      toast.error("Test request failed");
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete device ${name}? This removes its collected inventory.`)) return;
    try {
      await deleteCgnatDevice(id);
      toast.success("Device deleted", name);
      await load();
    } catch {
      toast.error("Delete failed", `Could not delete ${name}.`);
    }
  };

  const openEdit = (d: CgnatDevice) => {
    setEditingDevice(d);
    setEditForm({
      name: d.name,
      mgmt_ip: d.mgmt_ip,
      port: d.port,
      vendor: d.vendor,
      verify_ssl: d.verify_ssl,
      role: d.role ?? "",
      username: d.username ?? "",
      poll_interval_seconds: d.poll_interval_seconds,
      password: ""
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
    const payload: CgnatDeviceUpdate = { ...editForm };
    if (typeof payload.port !== "undefined") payload.port = Number(payload.port) || 443;
    if (typeof payload.poll_interval_seconds !== "undefined") payload.poll_interval_seconds = Number(payload.poll_interval_seconds) || 900;
    if (!payload.password || !payload.password.trim()) delete payload.password;
    try {
      const updated = await updateCgnatDevice(editingDevice.id, payload);
      toast.success("Device updated", updated.hostname || updated.name);
      setMessage(`Updated ${updated.hostname || updated.name}.`);
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
        <PageHeader title="CGNAT Devices — Admin" description="Register A10 Thunder / F5 BIG-IP CGNAT devices (REST)." />

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
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Vendor</label>
              <select className={field} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value as CgnatVendor })}>
                <option value="a10">A10 Thunder</option>
                <option value="f5">F5 BIG-IP</option>
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
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">HTTPS port</label>
              <input type="number" className={field} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Role (optional)</label>
              <input className={field} value={form.role ?? ""} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="CGNAT" />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Poll interval (s)</label>
              <input type="number" className={field} value={form.poll_interval_seconds} onChange={(e) => setForm({ ...form, poll_interval_seconds: Number(e.target.value) })} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input id="verify" type="checkbox" checked={!!form.verify_ssl} onChange={(e) => setForm({ ...form, verify_ssl: e.target.checked })} />
              <label htmlFor="verify" className="text-sm text-slate-300">Verify TLS certificate</label>
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={busy} className="rounded-md border border-primary-500 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Registering…" : "Register + Sync"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="border-b border-brand-800/70 px-4 py-3"><h2 className="text-sm font-semibold text-slate-100">Registered devices ({devices.length})</h2></div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-left">Mgmt IP</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Last Poll</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {devices.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No devices registered yet.</td></tr>
                ) : (
                  devices.map((d) => (
                    <tr key={d.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3 text-slate-100">{d.hostname || d.name}</td>
                      <td className="px-4 py-3 uppercase text-slate-300">{d.vendor}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-100">{d.mgmt_ip}</td>
                      <td className="px-4 py-3 text-slate-100">
                        {d.status}
                        {d.last_error ? <div className="text-xs text-rose-300">{d.last_error}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-100">{fmtDate(d.last_polled_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => handleTest(d.id)} disabled={actingId === d.id} className="mr-2 rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-primary-500 disabled:opacity-60">Test</button>
                        <button type="button" onClick={() => handleSync(d.id)} disabled={actingId === d.id} className="mr-2 rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-primary-500 disabled:opacity-60">{actingId === d.id ? "…" : "Sync"}</button>
                        <button type="button" onClick={() => openEdit(d)} className="mr-2 rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-primary-500">Edit</button>
                        <button type="button" onClick={() => handleDelete(d.id, d.hostname || d.name)} className="rounded-md border border-rose-600/50 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20">Delete</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Transition.Root show={Boolean(editingDevice)} as={Fragment} appear>
        <Dialog as="div" className="relative z-50" onClose={closeEdit}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/70" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95">
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
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Vendor</label>
                        <select className={field} value={editForm.vendor ?? "a10"} onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value as CgnatVendor })}>
                          <option value="a10">A10 Thunder</option>
                          <option value="f5">F5 BIG-IP</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Role</label>
                        <input className={field} value={editForm.role ?? ""} placeholder="CGNAT" onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Username</label>
                        <input className={field} value={editForm.username ?? ""} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} required />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Password</label>
                        <input type="password" className={field} value={editForm.password ?? ""} placeholder="Leave blank to keep current secret" onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">HTTPS port</label>
                        <input type="number" className={field} value={editForm.port ?? 443} onChange={(e) => setEditForm({ ...editForm, port: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Poll interval (s)</label>
                        <input type="number" className={field} value={editForm.poll_interval_seconds ?? 900} onChange={(e) => setEditForm({ ...editForm, poll_interval_seconds: Number(e.target.value) })} />
                      </div>
                      <div className="flex items-center gap-2 pt-6">
                        <input id="edit-verify" type="checkbox" checked={!!editForm.verify_ssl} onChange={(e) => setEditForm({ ...editForm, verify_ssl: e.target.checked })} />
                        <label htmlFor="edit-verify" className="text-sm text-slate-300">Verify TLS certificate</label>
                      </div>
                    </div>
                    {updateError ? <p className="text-sm text-rose-300">{updateError}</p> : null}
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={closeEdit} disabled={isUpdating} className="rounded-md border border-brand-700 bg-brand-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white disabled:opacity-60">Cancel</button>
                      <button type="submit" disabled={isUpdating} className="rounded-md border border-primary-500 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-60">{isUpdating ? "Saving…" : "Save changes"}</button>
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
