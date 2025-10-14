import { ChangeEvent } from "react";

import { AccessType } from "@/types";

interface SystemFiltersProps {
  search: string;
  accessType: AccessType | "all";
  onSearchChange: (value: string) => void;
  onAccessTypeChange: (value: AccessType | "all") => void;
}

export function SystemFilters({ search, accessType, onSearchChange, onAccessTypeChange }: SystemFiltersProps) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-800 bg-slate-900/60 p-4 lg:flex-row lg:items-center">
      <input
        type="search"
        value={search}
  onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
        placeholder="Search systems..."
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
      />
      <select
        value={accessType}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onAccessTypeChange(event.target.value as AccessType | "all")
        }
        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
      >
        <option value="all">All access types</option>
        <option value="gui">GUI only</option>
        <option value="cli">CLI only</option>
      </select>
    </div>
  );
}
