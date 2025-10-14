import { System } from "@/types";

interface SystemTableProps {
  systems: System[];
  onEdit: (system: System) => void;
  onDelete: (system: System) => void;
  onLaunchGui: (system: System) => void;
  onOpenTerminal: (system: System) => void;
  onViewCredentials: (system: System) => void;
}

export function SystemTable({ systems, onEdit, onDelete, onLaunchGui, onOpenTerminal, onViewCredentials }: SystemTableProps) {
  if (systems.length === 0) {
    return <p className="rounded-md border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No systems configured.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800">
        <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">System</th>
            <th className="px-4 py-3 text-left font-semibold">Management IP</th>
            <th className="px-4 py-3 text-left font-semibold">GUI Credentials</th>
            <th className="px-4 py-3 text-left font-semibold">CLI Credentials</th>
            <th className="px-4 py-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 text-sm">
          {systems.map((system) => (
            <tr key={system.id} className="bg-slate-900/40">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-100">{system.name}</div>
                <div className="text-xs text-slate-400">{system.id}</div>
              </td>
              <td className="px-4 py-3 text-slate-200">{system.ip_address}</td>
              <td className="px-4 py-3 text-slate-200">
                {system.credentials.filter((credential) => credential.access_scope === "gui").length === 0 ? (
                  <span className="text-xs text-slate-500">—</span>
                ) : (
                  <ul className="space-y-1">
                    {system.credentials
                      .filter((credential) => credential.access_scope === "gui")
                      .map((credential) => (
                        <li key={credential.id} className="text-xs text-slate-300">
                          {credential.user_id} @ {credential.login_endpoint}
                        </li>
                      ))}
                  </ul>
                )}
              </td>
              <td className="px-4 py-3 text-slate-200">
                {system.credentials.filter((credential) => credential.access_scope === "cli").length === 0 ? (
                  <span className="text-xs text-slate-500">—</span>
                ) : (
                  <ul className="space-y-1">
                    {system.credentials
                      .filter((credential) => credential.access_scope === "cli")
                      .map((credential) => (
                        <li key={credential.id} className="text-xs text-slate-300">
                          {credential.user_id} @ {credential.login_endpoint}
                        </li>
                      ))}
                  </ul>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-primary-500 hover:text-primary-200"
                    onClick={() => onViewCredentials(system)}
                  >
                    Credentials
                  </button>
                  {system.credentials.some((credential) => credential.access_scope === "gui") && (
                    <button
                      type="button"
                      className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-primary-500"
                      onClick={() => onLaunchGui(system)}
                    >
                      GUI Access
                    </button>
                  )}
                  {system.credentials.some((credential) => credential.access_scope === "cli") && (
                    <button
                      type="button"
                      className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-primary-500 hover:text-primary-100"
                      onClick={() => onOpenTerminal(system)}
                    >
                      CLI Access
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-yellow-500 hover:text-yellow-200"
                    onClick={() => onEdit(system)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-rose-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rose-300 transition hover:bg-rose-600/20 hover:text-rose-200"
                    onClick={() => onDelete(system)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
