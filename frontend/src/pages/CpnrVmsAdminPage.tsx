import { FormEvent, Fragment, useEffect, useState } from "react";

import { Dialog, Transition } from "@headlessui/react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/toast";
import {
  createCpnrVm,
  deleteCpnrVm,
  fetchCpnrVms,
  syncCpnrVm,
  testCpnrVm,
  updateCpnrVm,
  type CpnrVmUpdate
} from "@/services/cpnr";
import { parseApiDate } from "@/utils/datetime";
import { CpnrRole, CpnrVm, CpnrVmCreate } from "@/types";

const fmtDate = (v?: string | null) => {
  if (!v) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(parseApiDate(v));
  } catch {
    return v;
  }
};

const emptyForm: CpnrVmCreate = {
  name: "", mgmt_ip: "", port: 8443, site: "", service: "", role: "local",
  pair_id: "", verify_ssl: false, username: "admin", password: "", poll_interval_seconds: 900
};

const field = "w-full rounded-md border border-brand-700 bg-brand-900 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

export function CpnrVmsAdminPage() {
  const [vms, setVms] = useState<CpnrVm[]>([]);
  const [form, setForm] = useState<CpnrVmCreate>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CpnrVm | null>(null);
  const [editForm, setEditForm] = useState<CpnrVmUpdate>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const page = await fetchCpnrVms({ pageSize: 200 });
      setVms(page.items);
    } catch (err) {
      console.error("Failed to load CPNR VMs", err);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, port: Number(form.port) || 8443, pair_id: form.pair_id || null };
      const created = await createCpnrVm(payload);
      toast.success("CPNR VM registered", `${created.name} added. Running first sync…`);
      setForm(emptyForm);
      await load();
      try {
        const res = await syncCpnrVm(created.id);
        if (res.success) toast.success("First sync complete", Object.entries(res.counts).map(([k, v]) => `${k}:${v}`).join("  "));
        else toast.warning("First sync failed", res.message ?? undefined);
        await load();
      } catch {
        toast.warning("First sync didn't run", "Trigger a sync from the list when ready.");
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Registration failed", detail || undefined);
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async (id: string) => {
    setActingId(id);
    try {
      const res = await syncCpnrVm(id);
      if (res.success) toast.success("Sync complete", Object.entries(res.counts).map(([k, v]) => `${k}:${v}`).join("  "));
      else toast.error("Sync failed", res.message ?? undefined);
      await load();
    } catch { toast.error("Sync request failed"); } finally { setActingId(null); }
  };

  const handleTest = async (id: string) => {
    setActingId(id);
    try {
      const res = await testCpnrVm(id);
      if (res.reachable) toast.success("Connection successful");
      else toast.error("Connection failed", res.message ?? undefined);
    } catch { toast.error("Test request failed"); } finally { setActingId(null); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete CPNR VM ${name}? This removes its collected inventory.`)) return;
    try {
      await deleteCpnrVm(id);
      toast.success("VM deleted", name);
      await load();
    } catch { toast.error("Delete failed", `Could not delete ${name}.`); }
  };

  const openEdit = (v: CpnrVm) => {
    setEditing(v);
    setEditForm({
      name: v.name, mgmt_ip: v.mgmt_ip, port: v.port, site: v.site ?? "", service: v.service ?? "",
      role: v.role, pair_id: v.pair_id ?? "", verify_ssl: v.verify_ssl, username: v.username ?? "admin",
      poll_interval_seconds: v.poll_interval_seconds, password: ""
    });
  };
  const closeEdit = () => { if (!saving) { setEditing(null); setEditForm({}); } };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    const payload: CpnrVmUpdate = { ...editForm };
    if (typeof payload.port !== "undefined") payload.port = Number(payload.port) || 8443;
    if (typeof payload.poll_interval_seconds !== "undefined") payload.poll_interval_seconds = Number(payload.poll_interval_seconds) || 900;
    if (!payload.password || !payload.password.trim()) delete payload.password;
    try {
      const updated = await updateCpnrVm(editing.id, payload);
      toast.success("VM updated", updated.name);
      setEditing(null); setEditForm({});
      await load();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Update failed", detail || undefined);
    } finally { setSaving(false); }
  };

  const roleSelect = (value: CpnrRole, onChange: (r: CpnrRole) => void) => (
    <select className={field} value={value} onChange={(e) => onChange(e.target.value as CpnrRole)}>
      <option value="primary">Primary</option>
      <option value="secondary">Secondary</option>
      <option value="local">Local (single)</option>
    </select>
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader title="CPNR VMs — Admin" description="Register CPNR (DHCP) VMs over REST (8443). Set matching Pair IDs on a primary + secondary to enable consistency checks." />

        <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Register VM</h2>
          <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-3">
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Name</label><input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Management IP</label><input className={field} value={form.mgmt_ip} onChange={(e) => setForm({ ...form, mgmt_ip: e.target.value })} required /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Port</label><input type="number" className={field} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Site</label><input className={field} value={form.site ?? ""} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="Bangalore" /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Service</label><input className={field} value={form.service ?? ""} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder="Utility" /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Role</label>{roleSelect(form.role ?? "local", (r) => setForm({ ...form, role: r }))}</div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Pair ID (primary+secondary share)</label><input className={field} value={form.pair_id ?? ""} onChange={(e) => setForm({ ...form, pair_id: e.target.value })} placeholder="blr-utility" /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Username</label><input className={field} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Password</label><input type="password" className={field} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
            <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Poll interval (s)</label><input type="number" className={field} value={form.poll_interval_seconds} onChange={(e) => setForm({ ...form, poll_interval_seconds: Number(e.target.value) })} /></div>
            <div className="flex items-center gap-2 pt-6"><input id="verify" type="checkbox" checked={!!form.verify_ssl} onChange={(e) => setForm({ ...form, verify_ssl: e.target.checked })} /><label htmlFor="verify" className="text-sm text-slate-300">Verify TLS certificate</label></div>
            <div className="flex items-end"><button type="submit" disabled={busy} className="rounded-md border border-primary-500 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:opacity-60">{busy ? "Registering…" : "Register + Sync"}</button></div>
          </form>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="border-b border-brand-800/70 px-4 py-3"><h2 className="text-sm font-semibold text-slate-100">Registered VMs ({vms.length})</h2></div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Site / Service</th><th className="px-4 py-3 text-left">Role</th><th className="px-4 py-3 text-left">Pair</th><th className="px-4 py-3 text-left">Mgmt IP</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Last Poll</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {vms.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">No CPNR VMs registered yet.</td></tr>
                ) : (
                  vms.map((v) => (
                    <tr key={v.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3 text-slate-100">{v.name}</td>
                      <td className="px-4 py-3 text-slate-300">{v.site ?? "--"} / {v.service ?? "--"}</td>
                      <td className="px-4 py-3 text-slate-300">{v.role}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{v.pair_id ?? "--"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-100">{v.mgmt_ip}</td>
                      <td className="px-4 py-3 text-slate-100">{v.status}{v.last_error ? <div className="text-xs text-rose-300">{v.last_error}</div> : null}</td>
                      <td className="px-4 py-3 text-slate-100">{fmtDate(v.last_polled_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => handleTest(v.id)} disabled={actingId === v.id} className="mr-2 rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-primary-500 disabled:opacity-60">Test</button>
                        <button type="button" onClick={() => handleSync(v.id)} disabled={actingId === v.id} className="mr-2 rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-primary-500 disabled:opacity-60">{actingId === v.id ? "…" : "Sync"}</button>
                        <button type="button" onClick={() => openEdit(v)} className="mr-2 rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-primary-500">Edit</button>
                        <button type="button" onClick={() => handleDelete(v.id, v.name)} className="rounded-md border border-rose-600/50 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20">Delete</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Transition.Root show={Boolean(editing)} as={Fragment} appear>
        <Dialog as="div" className="relative z-50" onClose={closeEdit}>
          <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/70" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-lg border border-brand-800 bg-brand-900/95 p-6 shadow-xl transition-all">
                  <Dialog.Title className="text-lg font-semibold text-slate-100">Edit CPNR VM</Dialog.Title>
                  <form className="mt-4 space-y-4" onSubmit={handleUpdate}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Name</label><input className={field} value={editForm.name ?? ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Management IP</label><input className={field} value={editForm.mgmt_ip ?? ""} onChange={(e) => setEditForm({ ...editForm, mgmt_ip: e.target.value })} required /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Site</label><input className={field} value={editForm.site ?? ""} onChange={(e) => setEditForm({ ...editForm, site: e.target.value })} /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Service</label><input className={field} value={editForm.service ?? ""} onChange={(e) => setEditForm({ ...editForm, service: e.target.value })} /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Role</label>{roleSelect((editForm.role as CpnrRole) ?? "local", (r) => setEditForm({ ...editForm, role: r }))}</div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Pair ID</label><input className={field} value={editForm.pair_id ?? ""} onChange={(e) => setEditForm({ ...editForm, pair_id: e.target.value })} /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Username</label><input className={field} value={editForm.username ?? ""} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} required /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Password</label><input type="password" className={field} value={editForm.password ?? ""} placeholder="Leave blank to keep current" onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Port</label><input type="number" className={field} value={editForm.port ?? 8443} onChange={(e) => setEditForm({ ...editForm, port: Number(e.target.value) })} /></div>
                      <div><label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Poll interval (s)</label><input type="number" className={field} value={editForm.poll_interval_seconds ?? 900} onChange={(e) => setEditForm({ ...editForm, poll_interval_seconds: Number(e.target.value) })} /></div>
                      <div className="flex items-center gap-2 pt-6"><input id="edit-verify" type="checkbox" checked={!!editForm.verify_ssl} onChange={(e) => setEditForm({ ...editForm, verify_ssl: e.target.checked })} /><label htmlFor="edit-verify" className="text-sm text-slate-300">Verify TLS certificate</label></div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={closeEdit} disabled={saving} className="rounded-md border border-brand-700 bg-brand-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 disabled:opacity-60">Cancel</button>
                      <button type="submit" disabled={saving} className="rounded-md border border-primary-500 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
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
