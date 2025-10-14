import { useCallback, useEffect, useState } from "react";

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
import { AccessType, GroupDetail, GroupSummary, System, SystemCredentialSecret } from "@/types";

export function DashboardPage() {
  const token = useAuthStore((state: AuthState) => state.token) ?? "";

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [systems, setSystems] = useState<System[]>([]);
  const [search, setSearch] = useState("");
  const [accessFilter, setAccessFilter] = useState<AccessType | "all">("all");
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
        className="w-full rounded-md border border-dashed border-primary-500 px-3 py-2 text-sm font-semibold text-primary-300 transition hover:bg-primary-500/20"
        onClick={handleOpenCreateSystem}
        disabled={!activeGroupId}
      >
        + Add System
      </button>
    </div>
  );

  return (
    <AppShell sidebar={sidebar}>
      <div className="space-y-6">
        <SystemFilters
          search={search}
          accessType={accessFilter}
          onSearchChange={setSearch}
          onAccessTypeChange={setAccessFilter}
        />
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Systems</h2>
              {activeGroupId ? (
                <p className="text-sm text-slate-400">
                  Showing systems for selected group.
                </p>
              ) : (
                <p className="text-sm text-slate-400">Showing all systems.</p>
              )}
            </div>
            <button
              type="button"
              className="rounded-md border border-primary-500 px-3 py-2 text-sm font-semibold text-primary-300 transition hover:bg-primary-500/20"
              onClick={handleOpenCreateSystem}
              disabled={!activeGroupId}
            >
              Add System
            </button>
          </div>
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-slate-400">Loading systems...</div>
          ) : (
            <SystemTable
              systems={systems}
              onEdit={handleOpenEditSystem}
              onDelete={handleDeleteSystem}
              onLaunchGui={handleLaunchGui}
              onOpenTerminal={handleOpenTerminal}
              onViewCredentials={handleViewCredentials}
            />
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
