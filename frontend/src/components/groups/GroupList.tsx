import clsx from "clsx";

import { GroupSummary } from "@/types";

interface GroupListProps {
  groups: GroupSummary[];
  activeGroupId: string | null;
  onSelect: (groupId: string | null) => void;
  onAddGroup: () => void;
}

export function GroupList({ groups, activeGroupId, onSelect, onAddGroup }: GroupListProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Groups</h2>
        <button
          type="button"
          className="rounded-md border border-primary-500 px-2 py-1 text-xs font-semibold text-primary-300 transition hover:bg-primary-500/20"
          onClick={() => onAddGroup()}
        >
          + New
        </button>
      </div>
      <nav className="space-y-1">
        <button
          type="button"
          className={clsx(
            "w-full rounded-md px-3 py-2 text-left text-sm transition",
            activeGroupId === null
              ? "bg-primary-600/20 text-white"
              : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
          )}
          onClick={() => onSelect(null)}
        >
          All Systems
        </button>
        {groups.map((group) => (
          <button
            type="button"
            key={group.id}
            className={clsx(
              "w-full rounded-md px-3 py-2 text-left text-sm transition",
              group.id === activeGroupId
                ? "bg-primary-600/20 text-white"
                : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
            )}
            onClick={() => onSelect(group.id)}
          >
            <div className="flex flex-col">
              <span className="font-medium text-slate-100">{group.name}</span>
              {group.description && <span className="text-xs text-slate-400">{group.description}</span>}
            </div>
          </button>
        ))}
      </nav>
    </div>
  );
}
