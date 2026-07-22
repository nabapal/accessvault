import { useEffect, useState } from "react";

import api from "@/services/api";

interface VersionInfo {
  name: string;
  version: string;
  environment: string;
  git_sha: string;
  build_date: string;
}

// Environment chip colour: prod = emerald, pre_pod/staging = amber, dev = slate.
const envTone = (env: string): string => {
  const e = env.toLowerCase();
  if (e.startsWith("prod")) return "border-emerald-500/50 bg-emerald-500/15 text-emerald-200";
  if (e.startsWith("pre") || e.includes("stag")) return "border-amber-500/50 bg-amber-500/15 text-amber-200";
  return "border-slate-500/40 bg-slate-500/10 text-slate-300";
};

export function AppFooter() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<VersionInfo>("/version")
      .then(({ data }) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        /* footer is best-effort; ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;
  const sha = info.git_sha && info.git_sha !== "dev" ? ` (${info.git_sha})` : "";
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-brand-800/70 px-6 py-2 text-[11px] text-slate-500">
      {info.environment && (
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-medium uppercase tracking-wide ${envTone(info.environment)}`}>
          {info.environment}
        </span>
      )}
      <span>
        {info.name} v{info.version}
        {sha}
        {info.build_date ? ` · ${info.build_date}` : ""}
      </span>
    </footer>
  );
}
