import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { GroupList } from "@/components/groups/GroupList";
import { SystemFilters } from "@/components/systems/SystemFilters";
import { SystemModal } from "@/components/systems/SystemModal";
import { SystemCredentialsModal } from "@/components/systems/SystemCredentialsModal";
import { SystemTable } from "@/components/systems/SystemTable";
import { TerminalDrawer } from "@/components/terminal/TerminalDrawer";
import { AuthState, useAuthStore } from "@/stores/auth";
import { createGroup, fetchGroups } from "@/services/groups";
import {
  SystemFormValues,
  createSystem,
  deleteSystem,
  fetchSystemCredentialsWithSecrets,
  fetchSystems,
  requestGuiToken,
  updateSystem
} from "@/services/systems";
import { AccessType, GroupSummary, System, SystemCredentialSecret } from "@/types";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export function AccessVaultPage() {
  const token = useAuthStore((state: AuthState) => state.token) ?? "";

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [systems, setSystems] = useState<System[]>([]);
  const [search, setSearch] = useState("");
  const [accessFilter, setAccessFilter] = useState<AccessType | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [systemModalMode, setSystemModalMode] = useState<"create" | "edit">("create");
  const [selectedSystem, setSelectedSystem] = useState<System | null>(null);
  const [terminalState, setTerminalState] = useState<{ open: boolean; system: System | null }>({
    open: false,
    system: null
  });
  const [credentialsModalState, setCredentialsModalState] = useState<{
    open: boolean;
    system: System | null;
    credentials: SystemCredentialSecret[];
    isLoading: boolean;
  }>({
    open: false,
    system: null,
    credentials: [],
    isLoading: false
  });

  const loadGroups = useCallback(async () => {
    const data = await fetchGroups();
    setGroups(data);
  }, []);

  const loadSystems = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchSystems({
        group_id: activeGroupId ?? undefined,
        search: search || undefined,
        access_type: accessFilter !== "all" ? accessFilter : undefined
      });
      setSystems(data);
    } finally {
      setIsLoading(false);
    }
  }, [activeGroupId, search, accessFilter]);

  useEffect(() => {
  loadGroups().catch((error: unknown) => console.error("Failed to fetch groups", error));
  }, [loadGroups]);

  useEffect(() => {
  loadSystems().catch((error: unknown) => console.error("Failed to fetch systems", error));
  }, [loadSystems]);

  // Reset to first page whenever the result set changes shape.
  useEffect(() => {
    setPage(1);
  }, [activeGroupId, search, accessFilter, pageSize]);

  const totalSystems = systems.length;
  const totalPages = totalSystems > 0 ? Math.ceil(totalSystems / pageSize) : 1;

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedSystems = useMemo(() => {
    if (!totalSystems) return [];
    const start = (page - 1) * pageSize;
    return systems.slice(start, start + pageSize);
  }, [systems, page, pageSize, totalSystems]);

  const pageStart = totalSystems === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = totalSystems === 0 ? 0 : Math.min(page * pageSize, totalSystems);
  const canGoPrev = page > 1;
  const canGoNext = totalSystems > 0 && page < totalPages;

  const handleCreateGroup = async () => {
    const name = window.prompt("Group name");
    if (!name) return;
    const description = window.prompt("Description (optional)") ?? undefined;
    await createGroup({ name, description });
    await loadGroups();
  };

  const handleOpenCreateSystem = () => {
    setSystemModalMode("create");
    setSelectedSystem(null);
    setSystemModalOpen(true);
  };

  const handleOpenEditSystem = (system: System) => {
    setSystemModalMode("edit");
    setSelectedSystem(system);
    setSystemModalOpen(true);
  };

  const handleSaveSystem = async (values: SystemFormValues) => {
    const sanitizedCredentials = values.credentials.map((credential) => ({
      ...credential,
      user_id: credential.user_id.trim(),
      login_endpoint: credential.login_endpoint.trim(),
      password: credential.password && credential.password.trim().length > 0 ? credential.password.trim() : undefined
    }));
    const payload: SystemFormValues = {
      ...values,
      credentials: sanitizedCredentials
    };
    if (systemModalMode === "create") {
      if (!activeGroupId) {
        throw new Error("Select a group before creating systems");
      }
      await createSystem(activeGroupId, payload);
    } else if (selectedSystem) {
      await updateSystem(selectedSystem.id, payload);
    }
    await loadSystems();
  };

  const handleDeleteSystem = async (system: System) => {
    const confirmDelete = window.confirm(`Delete system ${system.name}?`);
    if (!confirmDelete) return;
    await deleteSystem(system.id);
    await loadSystems();
  };

  const handleLaunchGui = async (system: System) => {
    try {
      const { payload } = await requestGuiToken(system.id);
      let target = payload.login_endpoint.trim();
      let href = target;
      try {
        const parsed = new URL(target.includes("://") ? target : `https://${target}`);
        parsed.username = payload.user_id;
        parsed.password = payload.password;
        href = parsed.toString();
      } catch (error) {
        console.warn("Unable to parse login endpoint as URL, falling back to raw value", error);
      }
      const opened = window.open(href, "_blank", "noopener=yes");
      if (!opened) {
        alert("Popup blocked. Allow popups and try again.");
      }
    } catch (error) {
      console.error("GUI launch failed", error);
      alert("Unable to launch GUI session");
    }
  };

  const handleOpenTerminal = async (system: System) => {
    try {
      setTerminalState({ open: true, system });
    } catch (error) {
      console.error("Failed to open terminal", error);
    }
  };

  const handleViewCredentials = async (system: System) => {
    setCredentialsModalState({ open: true, system, credentials: [], isLoading: true });
    try {
      const data = await fetchSystemCredentialsWithSecrets(system.id);
      setCredentialsModalState({ open: true, system, credentials: data, isLoading: false });
    } catch (error) {
      console.error("Failed to load credentials", error);
      setCredentialsModalState({ open: true, system, credentials: [], isLoading: false });
      alert("Unable to load credentials for this system.");
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <GroupList
        groups={groups}
        activeGroupId={activeGroupId}
        onSelect={(groupId) => setActiveGroupId(groupId)}
        onAddGroup={handleCreateGroup}
      />
      <button
        type="button"
        className="w-full rounded-md border border-dashed border-primary-500 px-3 py-2 text-sm font-semibold text-primary-200 transition hover:bg-primary-500/20"
        onClick={handleOpenCreateSystem}
        disabled={!activeGroupId}
      >
        + Add System
      </button>
    </div>
  );

  return (
    <AppShell sidebarContent={sidebar}>
      <div className="space-y-6">
        <SystemFilters
          search={search}
          accessType={accessFilter}
          onSearchChange={setSearch}
          onAccessTypeChange={setAccessFilter}
        />
        <div className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4 shadow-inner shadow-black/20">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">AccessVault Systems</h2>
              {activeGroupId ? (
                <p className="text-sm text-slate-300">
                  Showing systems for selected group.
                </p>
              ) : (
                <p className="text-sm text-slate-300">Showing all systems.</p>
              )}
            </div>
            <button
              type="button"
              className="rounded-md border border-primary-500 px-3 py-2 text-sm font-semibold text-primary-200 transition hover:bg-primary-500/20"
              onClick={handleOpenCreateSystem}
              disabled={!activeGroupId}
            >
              Add System
            </button>
          </div>
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-slate-400">Loading systems...</div>
          ) : (
            <>
              <SystemTable
                systems={paginatedSystems}
                onEdit={handleOpenEditSystem}
                onDelete={handleDeleteSystem}
                onLaunchGui={handleLaunchGui}
                onOpenTerminal={handleOpenTerminal}
                onViewCredentials={handleViewCredentials}
              />
              {totalSystems > 0 && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">
                    Showing {pageStart}-{pageEnd} of {totalSystems} systems
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Rows</span>
                      <select
                        value={pageSize}
                        onChange={(event) => setPageSize(Number(event.currentTarget.value))}
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
              )}
            </>
          )}
        </div>
      </div>
      <SystemModal
        open={systemModalOpen}
        onClose={() => setSystemModalOpen(false)}
        mode={systemModalMode}
        initialValues={selectedSystem ?? undefined}
        onSubmit={handleSaveSystem}
      />
      <TerminalDrawer
        open={terminalState.open && Boolean(terminalState.system)}
        systemId={terminalState.system?.id ?? ""}
        systemName={terminalState.system?.name ?? ""}
        token={token}
        onClose={() => setTerminalState({ open: false, system: null })}
      />
      <SystemCredentialsModal
        open={credentialsModalState.open}
        onClose={() => setCredentialsModalState({ open: false, system: null, credentials: [], isLoading: false })}
        systemName={credentialsModalState.system?.name ?? ""}
        credentials={credentialsModalState.credentials}
        isLoading={credentialsModalState.isLoading}
      />
    </AppShell>
  );
}
