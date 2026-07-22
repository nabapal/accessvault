import { useEffect, useState } from "react";

import api from "@/services/api";

interface VersionInfo {
  name: string;
  version: string;
  git_sha: string;
  build_date: string;
}

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
    <footer className="border-t border-brand-800/70 px-6 py-2 text-right text-[11px] text-slate-500">
      {info.name} v{info.version}
      {sha}
      {info.build_date ? ` · ${info.build_date}` : ""}
    </footer>
  );
}
