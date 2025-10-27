import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Dialog, Transition } from "@headlessui/react";

import { AppShell } from "@/components/layout/AppShell";
import {
  CreateInventoryEndpointPayload,
  createInventoryEndpoint,
  fetchInventoryEndpoints,
  UpdateInventoryEndpointPayload,
  updateInventoryEndpoint,
  deleteInventoryEndpoint,
  syncInventoryEndpoint,
  testInventoryEndpoint,
  validateInventoryEndpoint
} from "@/services/inventory";
import { useAuthStore } from "@/stores/auth";
import {
  InventoryEndpoint,
  InventoryEndpointSyncResponse,
  InventoryEndpointValidationResult
} from "@/types";

const initialForm: CreateInventoryEndpointPayload = {
  name: "",
  address: "",
  port: 443,
  source_type: "esxi",
  username: "",
  password: "",
  verify_ssl: false,
  poll_interval_seconds: 300,
  description: "",
  tags: []
};

const statusColors: Record<string, string> = {
  ok: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  error: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  never: "border-slate-500/50 bg-slate-500/10 text-slate-200"
};

const statusLabels: Record<string, string> = {
  ok: "Healthy",
  error: "Attention",
  never: "Pending"
};

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

interface EndpointActionState {
  testingId: string | null;
  syncingId: string | null;
  summaries: Record<string, InventoryEndpointValidationResult>;
  errors: Record<string, string>;
}

const initialActionState: EndpointActionState = {
  testingId: null,
  syncingId: null,
  summaries: {},
  errors: {}
};

type StepKey = "credentials" | "preview" | "enroll";

const onboardingSteps: { key: StepKey; title: string; description: string }[] = [
  {
    key: "credentials",
    title: "Credentials",
    description: "Connect to the ESXi or vCenter endpoint"
  },
  {
    key: "preview",
    title: "Validate",
    description: "Run a live connectivity and discovery preview"
  },
  {
    key: "enroll",
    title: "Enroll",
    description: "Finalize tags, scheduling, and start polling"
  }
];

const DRAFT_STORAGE_KEY = "inventory-admin-draft";

export function InventoryAdminPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [endpoints, setEndpoints] = useState<InventoryEndpoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<CreateInventoryEndpointPayload>({ ...initialForm });
  const [tagsInput, setTagsInput] = useState<string>("");
  const [validationResult, setValidationResult] = useState<InventoryEndpointValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [actions, setActions] = useState<EndpointActionState>(initialActionState);
  const [activeStep, setActiveStep] = useState<StepKey>("credentials");
  const [lastValidatedPayload, setLastValidatedPayload] = useState<CreateInventoryEndpointPayload | null>(null);
  const [lastValidation, setLastValidation] = useState<InventoryEndpointValidationResult | null>(null);
  const [draftLoaded, setDraftLoaded] = useState<boolean>(false);
  const [collectorFilter, setCollectorFilter] = useState<"all" | "healthy" | "attention" | "pending">("all");
  const [editingEndpoint, setEditingEndpoint] = useState<InventoryEndpoint | null>(null);
  const [editForm, setEditForm] = useState<UpdateInventoryEndpointPayload>({});
  const [editTagsInput, setEditTagsInput] = useState<string>("");
  const [isUpdatingEndpoint, setIsUpdatingEndpoint] = useState<boolean>(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryEndpoint | null>(null);
  const [isDeletingEndpoint, setIsDeletingEndpoint] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentStepIndex = useMemo(
    () => Math.max(0, onboardingSteps.findIndex((step) => step.key === activeStep)),
    [activeStep]
  );

  const sanitizedPayload = useMemo((): CreateInventoryEndpointPayload => {
    const trimmedTags = tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    return {
      ...form,
      description: form.description?.trim() || undefined,
      port: form.port ?? 443,
      tags: trimmedTags,
      poll_interval_seconds: form.poll_interval_seconds ?? 300
    };
  }, [form, tagsInput]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    if (typeof window === "undefined") {
      setDraftLoaded(true);
      return;
    }

    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      setDraftLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        form?: Partial<CreateInventoryEndpointPayload>;
        tagsInput?: string;
      };
      if (parsed.form) {
        setForm((prev) => ({ ...prev, ...parsed.form, password: "" }));
      }
      if (parsed.tagsInput !== undefined) {
        setTagsInput(parsed.tagsInput);
      } else if (parsed.form?.tags) {
        setTagsInput(parsed.form.tags.join(", "));
      }
    } catch {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } finally {
      setDraftLoaded(true);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !draftLoaded) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const payload = {
      form: { ...form, password: "" },
      tagsInput
    };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
  }, [form, tagsInput, isAdmin, draftLoaded]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchInventoryEndpoints();
        if (isMounted) {
          setEndpoints(data);
          setLoadError(null);
        }
      } catch (error) {
        if (isMounted) {
          setLoadError((error as Error).message || "Unable to load endpoints");
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
  }, [isAdmin]);

  const refreshEndpoints = async () => {
    try {
      const data = await fetchInventoryEndpoints();
      setEndpoints(data);
    } catch (error) {
      setLoadError((error as Error).message || "Unable to load endpoints");
    }
  };

  const filteredEndpoints = useMemo(() => {
    switch (collectorFilter) {
      case "healthy":
        return endpoints.filter((endpoint) => endpoint.last_poll_status === "ok");
      case "attention":
        return endpoints.filter((endpoint) => endpoint.last_poll_status === "error");
      case "pending":
        return endpoints.filter((endpoint) => endpoint.last_poll_status === "never");
      default:
        return endpoints;
    }
  }, [collectorFilter, endpoints]);

  const collectorCounts = useMemo(() => ({
    total: endpoints.length,
    healthy: endpoints.filter((endpoint) => endpoint.last_poll_status === "ok").length,
    attention: endpoints.filter((endpoint) => endpoint.last_poll_status === "error").length,
    pending: endpoints.filter((endpoint) => endpoint.last_poll_status === "never").length
  }), [endpoints]);

  const handleResetForm = () => {
    setForm({ ...initialForm });
    setTagsInput("");
    setValidationResult(null);
    setLastValidatedPayload(null);
    setLastValidation(null);
    setFormError(null);
    setFormSuccess(null);
    setActiveStep("credentials");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  };

  const handleSaveDraft = () => {
    if (typeof window === "undefined") {
      return;
    }
    const payload = {
      form: { ...form, password: "" },
      tagsInput
    };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    setFormSuccess("Draft saved locally");
  };

  const openEditEndpoint = (endpoint: InventoryEndpoint) => {
    setEditingEndpoint(endpoint);
    setEditForm({
      name: endpoint.name,
      address: endpoint.address,
      port: endpoint.port,
      source_type: endpoint.source_type,
      username: endpoint.username,
      verify_ssl: endpoint.verify_ssl,
      poll_interval_seconds: endpoint.poll_interval_seconds,
      description: endpoint.description ?? "",
      tags: endpoint.tags,
      password: ""
    });
    setEditTagsInput(endpoint.tags.join(", "));
    setUpdateError(null);
  };

  const closeEditModal = () => {
    if (isUpdatingEndpoint) {
      return;
    }
    setEditingEndpoint(null);
    setEditForm({});
    setEditTagsInput("");
    setUpdateError(null);
  };

  const handleEditInputChange = (event: FormEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const { name, value, type } = target;

    if (name === "tags") {
      setEditTagsInput(value);
      return;
    }

    if (type === "checkbox") {
      setEditForm((prev) => ({ ...prev, [name]: (target as HTMLInputElement).checked }));
      return;
    }

    if (type === "number") {
      const numericValue = value === "" ? undefined : Number(value);
      setEditForm((prev) => ({ ...prev, [name]: numericValue }));
      return;
    }

    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleUpdateEndpoint = async () => {
    if (!editingEndpoint) {
      return;
    }
    setIsUpdatingEndpoint(true);
    setUpdateError(null);
    const tags = editTagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    const payload: UpdateInventoryEndpointPayload = {
      ...editForm,
      tags
    };

    if (payload.description !== undefined) {
      const trimmed = payload.description?.toString().trim();
      payload.description = trimmed ? trimmed : null;
    }

    if (payload.password !== undefined && payload.password.trim() === "") {
      delete payload.password;
    }

    try {
      await updateInventoryEndpoint(editingEndpoint.id, payload);
      setFormSuccess("Endpoint updated successfully");
      setFormError(null);
      closeEditModal();
      await refreshEndpoints();
    } catch (error) {
      setUpdateError((error as Error).message || "Unable to update endpoint");
    } finally {
      setIsUpdatingEndpoint(false);
    }
  };

  const openDeleteEndpoint = (endpoint: InventoryEndpoint) => {
    setDeleteTarget(endpoint);
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    if (isDeletingEndpoint) {
      return;
    }
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleDeleteEndpoint = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeletingEndpoint(true);
    setDeleteError(null);
    try {
      await deleteInventoryEndpoint(deleteTarget.id);
      setFormSuccess("Endpoint deleted successfully");
      setFormError(null);
      setDeleteTarget(null);
      await refreshEndpoints();
    } catch (error) {
      setDeleteError((error as Error).message || "Unable to delete endpoint");
    } finally {
      setIsDeletingEndpoint(false);
    }
  };

  const handleInputChange = (event: FormEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const { name, value, type } = target;

    if (name === "tags") {
      setTagsInput(value);
      return;
    }

    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: (target as HTMLInputElement).checked }));
      return;
    }

    if (type === "number") {
      const numericValue = value === "" ? undefined : Number(value);
      setForm((prev) => ({ ...prev, [name]: numericValue }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleValidate = async () => {
    setIsValidating(true);
    setFormError(null);
    setFormSuccess(null);
    setLastValidatedPayload(sanitizedPayload);
    try {
      const result = await validateInventoryEndpoint(sanitizedPayload);
      setValidationResult(result);
      setLastValidation(result);
    } catch (error) {
      const failure: InventoryEndpointValidationResult = {
        reachable: false,
        host_count: 0,
        virtual_machine_count: 0,
        datastore_count: 0,
        network_count: 0,
        message: (error as Error).message,
        collected_at: undefined
      };
      setValidationResult(failure);
      setLastValidation(failure);
    } finally {
      setIsValidating(false);
      setActiveStep("preview");
    }
  };

  const handleRevalidateLast = async () => {
    if (!lastValidatedPayload) {
      return;
    }
    setIsValidating(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const result = await validateInventoryEndpoint(lastValidatedPayload);
      setValidationResult(result);
      setLastValidation(result);
    } catch (error) {
      const failure: InventoryEndpointValidationResult = {
        reachable: false,
        host_count: 0,
        virtual_machine_count: 0,
        datastore_count: 0,
        network_count: 0,
        message: (error as Error).message,
        collected_at: undefined
      };
      setValidationResult(failure);
      setLastValidation(failure);
    } finally {
      setIsValidating(false);
      setActiveStep("preview");
    }
  };

  const handleCreate = async () => {
    if (!sanitizedPayload.name || !sanitizedPayload.address || !sanitizedPayload.username || !sanitizedPayload.password) {
      setFormError("Name, address, username, and password are required");
      return;
    }

    setIsCreating(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      await createInventoryEndpoint(sanitizedPayload);
      setForm({ ...initialForm });
      setTagsInput("");
      setFormSuccess("Endpoint created successfully");
      setLastValidation((prev) => validationResult ?? prev);
      setActiveStep("enroll");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
      await refreshEndpoints();
    } catch (error) {
      setFormError((error as Error).message || "Unable to create endpoint");
    } finally {
      setIsCreating(false);
    }
  };

  const handleTest = async (endpoint: InventoryEndpoint) => {
    setActions((prev) => ({ ...prev, testingId: endpoint.id, errors: { ...prev.errors, [endpoint.id]: "" } }));
    try {
      const result = await testInventoryEndpoint(endpoint.id);
      setActions((prev) => ({
        ...prev,
        testingId: null,
        summaries: { ...prev.summaries, [endpoint.id]: result }
      }));
    } catch (error) {
      setActions((prev) => ({
        ...prev,
        testingId: null,
        errors: { ...prev.errors, [endpoint.id]: (error as Error).message || "Unable to test endpoint" }
      }));
    }
  };

  const handleSync = async (endpoint: InventoryEndpoint) => {
    setActions((prev) => ({ ...prev, syncingId: endpoint.id, errors: { ...prev.errors, [endpoint.id]: "" } }));
    try {
      const response: InventoryEndpointSyncResponse = await syncInventoryEndpoint(endpoint.id);
      setEndpoints((prev) => prev.map((item) => (item.id === response.endpoint.id ? response.endpoint : item)));
      setActions((prev) => ({
        ...prev,
        syncingId: null,
        summaries: { ...prev.summaries, [endpoint.id]: response.summary }
      }));
    } catch (error) {
      setActions((prev) => ({
        ...prev,
        syncingId: null,
        errors: { ...prev.errors, [endpoint.id]: (error as Error).message || "Unable to sync endpoint" }
      }));
    }
  };

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto mt-16 max-w-2xl rounded-lg border border-brand-800/70 bg-brand-900/60 p-8 text-center text-slate-300">
          <h2 className="text-lg font-semibold text-slate-100">Inventory administration restricted</h2>
          <p className="mt-3 text-sm text-slate-400">
            You do not have permission to manage collector endpoints. Please contact an administrator if you believe this is an error.
          </p>
          <Link
            to="/inventory"
            className="mt-6 inline-flex items-center justify-center rounded-md border border-brand-700 bg-brand-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
          >
            Back to inventory
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-6 shadow-inner shadow-black/20">
          <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Collector Onboarding</h2>
              <p className="text-sm text-slate-400">Validate connectivity, then enroll the endpoint to begin polling.</p>
            </div>
            <div className="rounded-full border border-primary-500/40 px-3 py-1 text-xs font-medium uppercase tracking-[0.3em] text-primary-200">
              Admin tools
            </div>
          </header>
          <ol className="mb-6 flex flex-col gap-3 md:flex-row md:items-stretch md:gap-4">
            {onboardingSteps.map((step, index) => {
              const isActive = index === currentStepIndex;
              const isComplete = index < currentStepIndex;
              return (
                <li key={step.key} className="flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (index <= currentStepIndex) {
                        setActiveStep(step.key);
                      }
                    }}
                    className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left text-sm transition ${
                      isActive
                        ? "border-primary-500/50 bg-primary-500/10 text-primary-100"
                        : isComplete
                        ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-100 hover:bg-emerald-500/10"
                        : "border-brand-800/70 bg-brand-900/70 text-slate-300"
                    }`}
                    aria-current={isActive ? "step" : undefined}
                  >
                    <span
                      className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-semibold ${
                        isActive
                          ? "bg-primary-500 text-brand-900"
                          : isComplete
                          ? "bg-emerald-500 text-brand-900"
                          : "border border-brand-700 text-slate-200"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-xs uppercase tracking-wide text-slate-400">{step.title}</span>
                      <span className="text-xs text-slate-500">{step.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleValidate();
              }}
            >
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="name">
                  Collector name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={handleInputChange}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  placeholder="Prod ESXi Cluster"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="address">
                    Address / FQDN
                  </label>
                  <input
                    id="address"
                    name="address"
                    type="text"
                    value={form.address}
                    onChange={handleInputChange}
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                    placeholder="esxi01.internal"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="port">
                    Port
                  </label>
                  <input
                    id="port"
                    name="port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port ?? 443}
                    onChange={handleInputChange}
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="username">
                    Username
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={form.username}
                    onChange={handleInputChange}
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                    placeholder="root"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={form.password}
                    onChange={handleInputChange}
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                    placeholder="********"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="source_type">
                    Source type
                  </label>
                  <select
                    id="source_type"
                    name="source_type"
                    value={form.source_type}
                    onChange={handleInputChange}
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  >
                    <option value="esxi">ESXi host</option>
                    <option value="vcenter">vCenter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="poll_interval_seconds">
                    Poll interval (seconds)
                  </label>
                  <input
                    id="poll_interval_seconds"
                    name="poll_interval_seconds"
                    type="number"
                    min={60}
                    step={60}
                    value={form.poll_interval_seconds ?? 300}
                    onChange={handleInputChange}
                    className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="verify_ssl"
                  name="verify_ssl"
                  type="checkbox"
                  checked={Boolean(form.verify_ssl)}
                  onChange={handleInputChange}
                  className="h-4 w-4 rounded border-brand-700 bg-brand-900 text-primary-500 focus:ring-primary-400"
                />
                <label htmlFor="verify_ssl" className="text-xs text-slate-300">
                  Verify TLS certificates
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="tags">
                  Tags (comma separated)
                </label>
                <input
                  id="tags"
                  name="tags"
                  type="text"
                  value={tagsInput}
                  onChange={handleInputChange}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  placeholder="production, zone-a"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="description">
                  Description (optional)
                </label>
                <textarea
                  id="description"
                  name="description"
                  value={form.description ?? ""}
                  onChange={handleInputChange}
                  className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                  rows={3}
                  placeholder="Short note about the environment"
                />
              </div>
              {formError && <p className="text-sm text-rose-300">{formError}</p>}
              {formSuccess && <p className="text-sm text-emerald-300">{formSuccess}</p>}
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md border border-primary-500/40 bg-primary-500/20 px-4 py-2 text-sm font-medium text-primary-100 transition hover:bg-primary-500/30"
                  disabled={isValidating}
                >
                  {isValidating ? "Validating…" : "Validate connection"}
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="inline-flex items-center justify-center rounded-md border border-brand-700 bg-brand-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white disabled:opacity-50"
                  disabled={isCreating || Boolean(validationResult && !validationResult.reachable)}
                >
                  {isCreating ? "Saving…" : "Create endpoint"}
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  className="inline-flex items-center justify-center rounded-md border border-brand-800 bg-brand-900 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-primary-500 hover:text-white"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="inline-flex items-center justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200"
                >
                  Clear draft
                </button>
              </div>
            </form>
            <aside className="rounded-lg border border-brand-800/70 bg-brand-900/70 p-4">
              <h3 className="text-sm font-semibold text-slate-200">Connection summary</h3>
              {!validationResult && <p className="mt-3 text-sm text-slate-400">Run validation to preview discovered assets before enrolling the collector.</p>}
              {validationResult && (
                <div className="mt-3 space-y-3 text-sm text-slate-300">
                  <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${validationResult.reachable ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
                    <span className="text-xs uppercase tracking-wide">Status</span>
                    <span className="font-semibold">{validationResult.reachable ? "Reachable" : "Failed"}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded border border-brand-800/70 bg-brand-900/60 p-2">
                      <p className="text-slate-400">Hosts</p>
                      <p className="mt-1 text-lg font-semibold text-slate-100">{validationResult.host_count}</p>
                    </div>
                    <div className="rounded border border-brand-800/70 bg-brand-900/60 p-2">
                      <p className="text-slate-400">Virtual machines</p>
                      <p className="mt-1 text-lg font-semibold text-slate-100">{validationResult.virtual_machine_count}</p>
                    </div>
                    <div className="rounded border border-brand-800/70 bg-brand-900/60 p-2">
                      <p className="text-slate-400">Datastores</p>
                      <p className="mt-1 text-lg font-semibold text-slate-100">{validationResult.datastore_count}</p>
                    </div>
                    <div className="rounded border border-brand-800/70 bg-brand-900/60 p-2">
                      <p className="text-slate-400">Networks</p>
                      <p className="mt-1 text-lg font-semibold text-slate-100">{validationResult.network_count}</p>
                    </div>
                  </div>
                  {validationResult.message && (
                    <p className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
                      {validationResult.message}
                    </p>
                  )}
                  {validationResult.collected_at && (
                    <p className="text-xs text-slate-500">Collected: {formatDateTime(validationResult.collected_at)}</p>
                  )}
                  {lastValidation && (
                    <div className="rounded border border-brand-800/70 bg-brand-900/60 p-2 text-xs text-slate-400">
                      <p className="font-semibold text-slate-200">Last validation</p>
                      <p>
                        {lastValidation.reachable ? "Reachable" : "Failed"} • Hosts {lastValidation.host_count}, VMs {lastValidation.virtual_machine_count}
                      </p>
                      {lastValidation.collected_at && <p>Collected: {formatDateTime(lastValidation.collected_at)}</p>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleRevalidateLast}
                      disabled={!lastValidatedPayload || isValidating}
                      className="inline-flex items-center justify-center rounded-md border border-brand-700 bg-brand-800 px-3 py-1 text-[11px] font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white disabled:opacity-50"
                    >
                      {isValidating ? "Running…" : "Re-run last validation"}
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-4 text-xs text-slate-500">
                Validations do not persist data. Use "Create endpoint" once you are satisfied with the preview.
              </p>
              <p className="mt-2 text-[11px] text-slate-500">Drafts are stored locally in your browser. Clear draft to discard cached credentials.</p>
            </aside>
          </div>
        </section>

        <section className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-6">
          <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Registered collectors</h2>
              <p className="text-sm text-slate-400">Run health checks, trigger ad-hoc syncs, or manage poll settings.</p>
            </div>
            <button
              type="button"
              onClick={refreshEndpoints}
              className="inline-flex items-center justify-center rounded-md border border-brand-700 bg-brand-800 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
            >
              Refresh list
            </button>
          </header>
          {collectorCounts.total > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wide text-slate-400">Filter:</span>
              {(
                [
                  { key: "all" as const, label: `All (${collectorCounts.total})` },
                  { key: "healthy" as const, label: `Healthy (${collectorCounts.healthy})` },
                  { key: "attention" as const, label: `Attention (${collectorCounts.attention})` },
                  { key: "pending" as const, label: `Pending (${collectorCounts.pending})` }
                ]
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setCollectorFilter(option.key)}
                  className={`rounded-full border px-3 py-1 font-medium transition ${
                    collectorFilter === option.key
                      ? "border-primary-500/50 bg-primary-500/10 text-primary-100"
                      : "border-brand-800/70 bg-brand-900/70 text-slate-300 hover:border-primary-500/40 hover:text-white"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {isLoading && <p className="text-sm text-slate-400">Loading endpoints…</p>}
          {!isLoading && loadError && <p className="text-sm text-rose-300">{loadError}</p>}
          {!isLoading && !loadError && collectorCounts.total === 0 && (
            <p className="text-sm text-slate-400">No collectors registered yet. Use the onboarding form above to add your first endpoint.</p>
          )}
          {!isLoading && !loadError && collectorCounts.total > 0 && filteredEndpoints.length === 0 && (
            <p className="text-sm text-slate-400">No collectors match the selected filter.</p>
          )}
          {!isLoading && !loadError && filteredEndpoints.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 text-left">Endpoint</th>
                    <th className="px-3 text-left">Connection</th>
                    <th className="px-3 text-left">Polling</th>
                    <th className="px-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEndpoints.map((endpoint) => {
                    const summary = actions.summaries[endpoint.id];
                    const error = actions.errors[endpoint.id];
                    const statusBadgeClass = statusColors[endpoint.last_poll_status] ?? statusColors.never;
                    const statusLabel = statusLabels[endpoint.last_poll_status] ?? "Unknown";
                    const pollMinutes = Math.max(1, Math.round(endpoint.poll_interval_seconds / 60));
                    return (
                      <tr key={endpoint.id} className="rounded-lg border border-brand-800/70 bg-brand-900/70 align-top">
                        <td className="px-3 py-3">
                          <div className="text-sm font-semibold text-slate-100">{endpoint.name}</div>
                          <div className="text-xs text-slate-400">{endpoint.description || "No description"}</div>
                          {endpoint.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {endpoint.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded border border-primary-500/40 bg-primary-500/10 px-2 py-0.5 text-[11px] text-primary-100"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-300">
                          <div>{endpoint.address}:{endpoint.port}</div>
                          <div className="text-slate-500">{endpoint.source_type === "vcenter" ? "vCenter" : "ESXi host"}</div>
                          <div className={`mt-2 inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${statusBadgeClass}`}>
                            {statusLabel}
                          </div>
                          <div className="mt-1 text-slate-500">Last poll: {formatDateTime(endpoint.last_polled_at)}</div>
                          {endpoint.last_error_message && (
                            <div className="mt-1 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-200">
                              {endpoint.last_error_message}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-300">
                          <div>Interval: {pollMinutes} min</div>
                          <div className="mt-1 text-slate-500">Created: {formatDateTime(endpoint.created_at)}</div>
                          <div className="text-slate-500">Updated: {formatDateTime(endpoint.updated_at)}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-300">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openEditEndpoint(endpoint)}
                              className="rounded-md border border-brand-700 bg-brand-900 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-primary-500 hover:text-white"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeleteEndpoint(endpoint)}
                              className="rounded-md border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTest(endpoint)}
                              className="rounded-md border border-brand-700 bg-brand-800 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white disabled:opacity-50"
                              disabled={actions.testingId === endpoint.id}
                            >
                              {actions.testingId === endpoint.id ? "Testing…" : "Test connection"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSync(endpoint)}
                              className="rounded-md border border-primary-500/40 bg-primary-500/20 px-3 py-1 text-xs font-medium text-primary-100 transition hover:bg-primary-500/30 disabled:opacity-50"
                              disabled={actions.syncingId === endpoint.id}
                            >
                              {actions.syncingId === endpoint.id ? "Syncing…" : "Sync now"}
                            </button>
                          </div>
                          {summary && (
                            <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                              <div className={`font-medium ${summary.reachable ? "text-emerald-300" : "text-rose-300"}`}>
                                {summary.reachable ? "Reachable" : "Failed"}
                              </div>
                              <div>Hosts: {summary.host_count} • VMs: {summary.virtual_machine_count}</div>
                              <div>Datastores: {summary.datastore_count} • Networks: {summary.network_count}</div>
                              {summary.message && <div className="text-rose-300">{summary.message}</div>}
                              {summary.collected_at && (
                                <div className="text-slate-500">Collected: {formatDateTime(summary.collected_at)}</div>
                              )}
                            </div>
                          )}
                          {error && <div className="mt-3 text-[11px] text-rose-300">{error}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Transition.Root show={Boolean(editingEndpoint)} as={Fragment} appear>
        <Dialog as="div" className="relative z-50" onClose={closeEditModal}>
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
                  <Dialog.Title className="text-lg font-semibold text-slate-100">Edit collector</Dialog.Title>
                  <p className="mt-1 text-sm text-slate-400">Update connection details, tags, or polling settings.</p>

                  <form
                    className="mt-4 space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleUpdateEndpoint();
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-name">
                          Name
                        </label>
                        <input
                          id="edit-name"
                          name="name"
                          type="text"
                          value={editForm.name ?? ""}
                          onChange={handleEditInputChange}
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-source-type">
                          Source type
                        </label>
                        <select
                          id="edit-source-type"
                          name="source_type"
                          value={editForm.source_type ?? "esxi"}
                          onChange={handleEditInputChange}
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                        >
                          <option value="esxi">ESXi host</option>
                          <option value="vcenter">vCenter</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-address">
                          Address
                        </label>
                        <input
                          id="edit-address"
                          name="address"
                          type="text"
                          value={editForm.address ?? ""}
                          onChange={handleEditInputChange}
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-port">
                          Port
                        </label>
                        <input
                          id="edit-port"
                          name="port"
                          type="number"
                          min={1}
                          max={65535}
                          value={editForm.port ?? 443}
                          onChange={handleEditInputChange}
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-username">
                          Username
                        </label>
                        <input
                          id="edit-username"
                          name="username"
                          type="text"
                          value={editForm.username ?? ""}
                          onChange={handleEditInputChange}
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-password">
                          Password
                        </label>
                        <input
                          id="edit-password"
                          name="password"
                          type="password"
                          value={editForm.password ?? ""}
                          onChange={handleEditInputChange}
                          placeholder="Leave blank to keep current secret"
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        name="verify_ssl"
                        checked={Boolean(editForm.verify_ssl)}
                        onChange={handleEditInputChange}
                        className="h-4 w-4 rounded border-brand-700 bg-brand-900 text-primary-500 focus:ring-primary-500"
                      />
                      Verify TLS certificates
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-interval">
                          Poll interval (seconds)
                        </label>
                        <input
                          id="edit-interval"
                          name="poll_interval_seconds"
                          type="number"
                          min={60}
                          value={editForm.poll_interval_seconds ?? 300}
                          onChange={handleEditInputChange}
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-tags">
                          Tags
                        </label>
                        <input
                          id="edit-tags"
                          name="tags"
                          type="text"
                          value={editTagsInput}
                          onChange={handleEditInputChange}
                          placeholder="Comma separated"
                          className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="edit-description">
                        Description
                      </label>
                      <textarea
                        id="edit-description"
                        name="description"
                        value={editForm.description ?? ""}
                        onChange={handleEditInputChange}
                        rows={3}
                        className="mt-1 w-full rounded-md border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                    {updateError && <p className="text-sm text-rose-300">{updateError}</p>}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeEditModal}
                        className="rounded-md border border-brand-700 bg-brand-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
                        disabled={isUpdatingEndpoint}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded-md border border-primary-500/60 bg-primary-500/20 px-4 py-2 text-sm font-medium text-primary-100 transition hover:bg-primary-500/30 disabled:opacity-50"
                        disabled={isUpdatingEndpoint}
                      >
                        {isUpdatingEndpoint ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      <Transition.Root show={Boolean(deleteTarget)} as={Fragment} appear>
        <Dialog as="div" className="relative z-50" onClose={closeDeleteModal}>
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
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg border border-brand-800 bg-brand-900/95 p-6 shadow-xl transition-all">
                  <Dialog.Title className="text-lg font-semibold text-slate-100">Delete collector</Dialog.Title>
                  <p className="mt-2 text-sm text-slate-300">
                    Are you sure you want to remove {deleteTarget?.name}? This stops polling and removes stored credentials for this endpoint.
                  </p>
                  {deleteError && <p className="mt-4 text-sm text-rose-300">{deleteError}</p>}
                  <div className="mt-6 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeDeleteModal}
                      className="rounded-md border border-brand-700 bg-brand-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary-500 hover:bg-brand-700 hover:text-white"
                      disabled={isDeletingEndpoint}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteEndpoint}
                      className="rounded-md border border-rose-500/60 bg-rose-500/20 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/30 disabled:opacity-50"
                      disabled={isDeletingEndpoint}
                    >
                      {isDeletingEndpoint ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    </AppShell>
  );
}
