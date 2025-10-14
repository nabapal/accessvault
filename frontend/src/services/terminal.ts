const getWsBaseUrl = () => {
  const override = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  if (override) {
    return override.replace(/\/$/, "");
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.host;

  // When running through the Vite dev server we rely on the proxy that forwards `/ws`.
  if (host.includes("localhost:5173")) {
    return `${protocol}://${host}/ws`;
  }

  return `${protocol}://${host}`;
};

export const buildTerminalUrl = (systemId: string, token: string) => {
  const baseUrl = getWsBaseUrl();
  return `${baseUrl}/api/v1/terminal/${systemId}?token=${encodeURIComponent(token)}`;
};
