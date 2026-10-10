import { DbError } from "./DataProvider";

/** Turns database/network errors into a user-facing i18n key + detail. */
export function errorKey(e: unknown): string {
  if (e instanceof DbError) {
    const m = e.message.toLowerCase();
    if (e.code === "23503" && m.includes("still referenced")) return "err.in_use";
    if (e.code === "23503" && (m.includes("violates foreign key") || m.includes("update or delete"))) return "err.in_use";
    if (e.code === "23503") return "err.reference";
    if (e.code === "23505" && m.includes("recurring_occurrence")) return "err.already_paid";
    if (e.code === "23505") return "err.duplicate";
    if (e.code === "23514" || e.code === "22023" || e.code === "22P02" || e.code === "22003") return "err.invalid";
    if (e.code === "42501" || e.code === "PGRST301") return "err.auth";
    if (m.includes("failed to fetch") || m.includes("network")) return "err.network";
  }
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return "err.network";
  return "err.generic";
}

export function errorText(e: unknown, t: (k: string, p?: Record<string, string | number>) => string): string {
  const key = errorKey(e);
  const detail = e instanceof Error ? e.message : String(e);
  // custom messages raised by our database triggers are already human readable (English)
  if (key === "err.invalid" && e instanceof DbError && !/violates check constraint/i.test(e.message)) {
    return `${t(key)} ${detail}`;
  }
  return t(key);
}
