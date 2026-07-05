// Backend timestamps are stored in UTC but serialized without a timezone
// designator (SQLite returns naive datetimes, e.g. "2026-07-05T11:35:00").
// The browser would otherwise parse those as *local* time. Treat a tz-less
// string as UTC so downstream formatting (in IST) shifts it correctly.
export function parseApiDate(value: string): Date {
  const trimmed = value.trim();
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  return new Date(hasTz ? trimmed : `${trimmed}Z`);
}
