import { FormEvent, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import {
  createTelcoOnboardingJob,
  deleteTelcoOnboardingJob,
  listTelcoOnboardingJobs,
  validateTelcoOnboardingJob
} from "@/services/telco";
import { TelcoFabricType, TelcoOnboardingJob, TelcoOnboardingStatus } from "@/types";

interface FabricFormState {
  name: string;
  targetHost: string;
  username: string;
  description: string;
  port: string;
  verifySsl: boolean;
  transport: string;
  password: string;
  pollInterval: string;
  autoValidate: boolean;
}

const defaultAciForm: FabricFormState = {
  name: "",
  targetHost: "",
  username: "",
  description: "",
  port: "443",
  verifySsl: true,
  transport: "https",
  password: "",
  pollInterval: "600",
  autoValidate: true
};

const defaultNxosForm: FabricFormState = {
  name: "",
  targetHost: "",
  username: "",
  description: "",
  port: "443",
  verifySsl: false,
  transport: "nxapi-https",
  password: "",
  pollInterval: "900",
  autoValidate: true
};

const statusBadge: Record<TelcoOnboardingStatus, string> = {
  pending: "border-slate-600/60 bg-slate-800/50 text-slate-200",
  validating: "border-blue-500/60 bg-blue-500/15 text-blue-100",
  ready: "border-emerald-500/60 bg-emerald-500/15 text-emerald-100",
  failed: "border-rose-500/60 bg-rose-500/15 text-rose-100"
};

const statusLabel: Record<TelcoOnboardingStatus, string> = {
  pending: "Pending",
  validating: "Validating",
  ready: "Ready",
  failed: "Failed"
};

const formatDate = (value?: string | null) => {
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

const formatSeconds = (value?: number | null) => {
  if (!value || value <= 0) {
    return "--";
  }
  if (value < 60) {
    return `${value}s`;
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
};

const normalizeConnectionParams = (fabricType: TelcoFabricType, form: FabricFormState) => {
  if (fabricType === "aci") {
    return {
      protocol: form.transport
    };
  }
  return {
    transport: form.transport
  };
};

const renderSnapshotSummary = (job: TelcoOnboardingJob) => {
  const snapshot = job.last_snapshot;
  if (!snapshot) {
    return "--";
  }
  if (job.fabric_type === "aci") {
    const count = snapshot["fabric_node_count"];
    if (typeof count === "number") {
      return `${count} nodes`;
    }
  }
  if (job.fabric_type === "nxos") {
    const modules = snapshot["module_count"];
    if (typeof modules === "number") {
      return `${modules} modules`;
    }
  }
  const keys = Object.keys(snapshot);
  if (keys.length === 0) {
    return "--";
  }
  return keys
    .map((key) => `${key}: ${String(snapshot[key])}`)
    .slice(0, 2)
    .join(", ");
};

export function TelcoOnboardingPage() {
  const [aciForm, setAciForm] = useState<FabricFormState>(defaultAciForm);
  const [nxosForm, setNxosForm] = useState<FabricFormState>(defaultNxosForm);
  const [jobs, setJobs] = useState<TelcoOnboardingJob[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const data = await listTelcoOnboardingJobs();
      setJobs(data);
      setError(null);
    } catch (err) {
      console.error("Failed to load Telco onboarding jobs", err);
      setError("Unable to load onboarding jobs. Please retry.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>, fabricType: TelcoFabricType) => {
    event.preventDefault();
    setFeedback(null);

    const formState = fabricType === "aci" ? aciForm : nxosForm;
    if (!formState.name.trim() || !formState.targetHost.trim()) {
      setError("Name and target host are required.");
      return;
    }

    const password = formState.password.trim();
    if (!password) {
      setError("A credential password is required for onboarding.");
      return;
    }

    const parsedPort = Number.parseInt(formState.port, 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : fabricType === "aci" ? 443 : 443;

    const parsedInterval = Number.parseInt(formState.pollInterval, 10);
    if (!Number.isFinite(parsedInterval) || parsedInterval < 60) {
      setError("Polling interval must be at least 60 seconds.");
      return;
    }

    const pollInterval = parsedInterval;

    setIsSubmitting(true);
    try {
      await createTelcoOnboardingJob({
        name: formState.name.trim(),
        fabric_type: fabricType,
        target_host: formState.targetHost.trim(),
        port,
        username: formState.username.trim() || undefined,
        description: formState.description.trim() || undefined,
        verify_ssl: formState.verifySsl,
        connection_params: normalizeConnectionParams(fabricType, formState),
        poll_interval_seconds: pollInterval,
        password,
        auto_validate: formState.autoValidate
      });
      setFeedback(`Submitted ${fabricType.toUpperCase()} onboarding request.`);
      setError(null);
      if (fabricType === "aci") {
        setAciForm(defaultAciForm);
      } else {
        setNxosForm(defaultNxosForm);
      }
      await loadJobs();
    } catch (err) {
      console.error("Failed to submit onboarding request", err);
      setError("Unable to submit onboarding request. Please check details and retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleValidate = async (jobId: string) => {
    const job = jobs.find((item) => item.id === jobId);
    if (job && !job.has_credentials) {
      setError("Credentials are not stored for this fabric. Re-onboard with credentials before validating.");
      return;
    }
    try {
      await validateTelcoOnboardingJob(jobId, { force_fail: false });
      await loadJobs();
      setFeedback("Validation completed successfully.");
      setError(null);
    } catch (err) {
      console.error("Failed to trigger validation", err);
      setError("Unable to trigger validation. Please retry.");
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await deleteTelcoOnboardingJob(jobId);
      await loadJobs();
    } catch (err) {
      console.error("Failed to delete onboarding job", err);
      setError("Unable to delete onboarding job.");
    }
  };

  const recentJobs = useMemo(() => [...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at)), [jobs]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary-200">Telco</p>
          <h1 className="text-2xl font-semibold text-white">Fabric Onboarding</h1>
          <p className="text-sm text-slate-300">
            Provision Cisco ACI and NX-OS fabrics into the AccessVault inventory, including credential checks and
            telemetry bootstrap.
          </p>
        </header>

        {feedback ? <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">{feedback}</div> : null}
        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <form className="rounded-lg border border-brand-700 bg-brand-900/60 p-6 shadow-sm" onSubmit={(event) => handleSubmit(event, "aci")}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Cisco ACI Fabric</h2>
                <p className="text-xs text-slate-400">Provide APIC connection details and we will stage the fabric import.</p>
              </div>
              <span className="rounded-full border border-primary-500/60 bg-primary-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-100">
                ACI
              </span>
            </div>
            <div className="mt-4 grid gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Fabric name</label>
                <input
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  value={aciForm.name}
                  onChange={(event) => setAciForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g. Telco DC Fabric"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">APIC host/IP</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={aciForm.targetHost}
                    onChange={(event) => setAciForm((prev) => ({ ...prev, targetHost: event.target.value }))}
                    placeholder="10.64.135.132"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">API port</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={aciForm.port}
                    onChange={(event) => setAciForm((prev) => ({ ...prev, port: event.target.value }))}
                    type="number"
                    min={1}
                    max={65535}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Service account</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={aciForm.username}
                    onChange={(event) => setAciForm((prev) => ({ ...prev, username: event.target.value }))}
                    placeholder="nabaa"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Password</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={aciForm.password}
                    onChange={(event) => setAciForm((prev) => ({ ...prev, password: event.target.value }))}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Poll interval (seconds)</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={aciForm.pollInterval}
                    onChange={(event) => setAciForm((prev) => ({ ...prev, pollInterval: event.target.value }))}
                    type="number"
                    min={60}
                    step={30}
                  />
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <input
                    id="aci-verify"
                    type="checkbox"
                    className="h-4 w-4 rounded border-brand-700 bg-brand-900/70 text-primary-500 focus:ring-primary-500"
                    checked={aciForm.verifySsl}
                    onChange={(event) => setAciForm((prev) => ({ ...prev, verifySsl: event.target.checked }))}
                  />
                  <label htmlFor="aci-verify" className="text-sm text-slate-300">
                    Verify TLS certificates
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</label>
                <textarea
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  rows={3}
                  value={aciForm.description}
                  onChange={(event) => setAciForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Any staging notes or maintenance windows"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-brand-700 bg-brand-900/70 text-primary-500 focus:ring-primary-500"
                    checked={aciForm.autoValidate}
                    onChange={(event) => setAciForm((prev) => ({ ...prev, autoValidate: event.target.checked }))}
                  />
                  Auto validate immediately
                </label>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md border border-primary-500/60 bg-primary-500/15 px-4 py-2 text-sm font-semibold text-primary-100 transition hover:border-primary-400 hover:bg-primary-500/25"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </div>
          </form>

          <form className="rounded-lg border border-brand-700 bg-brand-900/60 p-6 shadow-sm" onSubmit={(event) => handleSubmit(event, "nxos")}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">NX-OS Fabric</h2>
                <p className="text-xs text-slate-400">Register core switching fabrics via NX-API or SSH automation.</p>
              </div>
              <span className="rounded-full border border-blue-500/60 bg-blue-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-100">
                NX-OS
              </span>
            </div>
            <div className="mt-4 grid gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Fabric name</label>
                <input
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={nxosForm.name}
                  onChange={(event) => setNxosForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g. Core Switching"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Primary endpoint</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={nxosForm.targetHost}
                    onChange={(event) => setNxosForm((prev) => ({ ...prev, targetHost: event.target.value }))}
                    placeholder="core-switch.local"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Port</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={nxosForm.port}
                    onChange={(event) => setNxosForm((prev) => ({ ...prev, port: event.target.value }))}
                    type="number"
                    min={1}
                    max={65535}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Service account</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={nxosForm.username}
                    onChange={(event) => setNxosForm((prev) => ({ ...prev, username: event.target.value }))}
                    placeholder="svc-net"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Password</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={nxosForm.password}
                    onChange={(event) => setNxosForm((prev) => ({ ...prev, password: event.target.value }))}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Transport</label>
                  <select
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={nxosForm.transport}
                    onChange={(event) => setNxosForm((prev) => ({ ...prev, transport: event.target.value }))}
                  >
                    <option value="ssh">SSH</option>
                    <option value="nxapi-http">NX-API HTTP</option>
                    <option value="nxapi-https">NX-API HTTPS</option>
                  </select>
                  {nxosForm.transport === "ssh" ? (
                    <p className="mt-1 text-xs text-amber-300">
                      SSH automation is not yet supported; use NX-API when available.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Poll interval (seconds)</label>
                  <input
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={nxosForm.pollInterval}
                    onChange={(event) => setNxosForm((prev) => ({ ...prev, pollInterval: event.target.value }))}
                    type="number"
                    min={60}
                    step={30}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="nxos-verify"
                  type="checkbox"
                  className="h-4 w-4 rounded border-brand-700 bg-brand-900/70 text-blue-500 focus:ring-blue-500"
                  checked={nxosForm.verifySsl}
                  onChange={(event) => setNxosForm((prev) => ({ ...prev, verifySsl: event.target.checked }))}
                />
                <label htmlFor="nxos-verify" className="text-sm text-slate-300">
                  Verify TLS certificates (applies to NX-API HTTPS)
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</label>
                <textarea
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                  value={nxosForm.description}
                  onChange={(event) => setNxosForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Any prerequisites, jump hosts, or ordering constraints"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-brand-700 bg-brand-900/70 text-blue-500 focus:ring-blue-500"
                    checked={nxosForm.autoValidate}
                    onChange={(event) => setNxosForm((prev) => ({ ...prev, autoValidate: event.target.checked }))}
                  />
                  Auto validate immediately
                </label>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md border border-blue-500/60 bg-blue-500/15 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:border-blue-400 hover:bg-blue-500/25"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="flex items-center justify-between border-b border-brand-800/60 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Recent Onboarding Jobs</h2>
              <p className="text-xs text-slate-400">Track validation results and retry onboarding flows as needed.</p>
            </div>
            <button
              type="button"
              className="rounded-md border border-brand-700 bg-brand-800 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
              onClick={loadJobs}
            >
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/60 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Fabric</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Target</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Last Run</th>
                  <th className="px-4 py-3 text-left">Snapshot</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                      Loading onboarding jobs…
                    </td>
                  </tr>
                ) : recentJobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                      No onboarding jobs yet. Submit a fabric above to get started.
                    </td>
                  </tr>
                ) : (
                  recentJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white">{job.name}</div>
                        {job.description ? <div className="text-xs text-slate-400">{job.description}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-200">{job.fabric_type.toUpperCase()}</td>
                      <td className="px-4 py-3">
                        <div>{job.target_host}:{job.port}</div>
                        {job.username ? <div className="text-xs text-slate-400">User: {job.username}</div> : null}
                        <div className="text-xs text-slate-500">Poll every {formatSeconds(job.poll_interval_seconds)}</div>
                        <div className="text-xs text-slate-500">Credentials: {job.has_credentials ? "Stored" : "Missing"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadge[job.status]}`}
                        >
                          {statusLabel[job.status]}
                        </span>
                        {job.last_error ? (
                          <div className="mt-1 text-xs text-rose-200">{job.last_error}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        {formatDate(job.last_polled_at ?? job.last_validation_completed_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-200">{renderSnapshotSummary(job)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-primary-500/60 bg-primary-500/15 px-3 py-1 text-xs font-semibold text-primary-100 transition hover:border-primary-400 hover:bg-primary-500/25"
                            onClick={() => handleValidate(job.id)}
                          >
                            Validate
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 transition hover:border-rose-400 hover:bg-rose-500/20"
                            onClick={() => handleDelete(job.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
