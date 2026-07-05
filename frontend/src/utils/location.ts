// Location derived from the first 4 letters of a device / node name.
// Extend this map as more site codes appear in the fleet.
export const SITE_CODES: Record<string, string> = {
  BGLR: "Bangalore",
  MUMB: "Mumbai",
  NVMB: "Navi Mumbai",
  JMNR: "Jamnagar"
};

export const locationFromName = (name?: string | null): string => {
  if (!name) return "Unknown";
  const code = name.slice(0, 4).toUpperCase();
  return SITE_CODES[code] ?? code;
};
