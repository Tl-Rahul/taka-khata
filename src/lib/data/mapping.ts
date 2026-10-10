import type { TableName } from "@/lib/finance/types";
import { toDecimalString, toPaisa, toPaisaOrNull } from "@/lib/finance/money";

/** Money columns per table (numeric in DB, integer paisa in the app). */
export const MONEY_FIELDS: Record<TableName, { required: string[]; nullable: string[] }> = {
  accounts: { required: ["opening_balance"], nullable: ["credit_limit"] },
  categories: { required: [], nullable: [] },
  contacts: { required: [], nullable: [] },
  loans: { required: ["opening_principal", "opening_interest_due"], nullable: ["fixed_interest", "installment_amount"] },
  recurring: { required: ["amount"], nullable: [] },
  transactions: { required: ["amount", "interest", "fee"], nullable: [] },
  budgets: { required: ["amount"], nullable: [] },
  goals: { required: ["target_amount"], nullable: [] },
  goal_entries: { required: ["amount"], nullable: [] },
  holdings: { required: [], nullable: [] },
  holding_valuations: { required: ["value"], nullable: [] },
};

/** Numeric (non-money) columns that come back from PostgREST as strings. */
const NUMBER_FIELDS: Partial<Record<TableName, string[]>> = {
  accounts: ["interest_rate"],
  loans: ["interest_rate"],
};

type Row = Record<string, unknown>;

export function fromDb<T>(table: TableName, row: Row): T {
  const out: Row = { ...row };
  const m = MONEY_FIELDS[table];
  for (const f of m.required) out[f] = toPaisa(row[f] as string);
  for (const f of m.nullable) out[f] = toPaisaOrNull(row[f] as string);
  for (const f of NUMBER_FIELDS[table] ?? []) out[f] = row[f] === null || row[f] === undefined ? null : Number(row[f]);
  delete out.user_id;
  return out as T;
}

/** Strips server-managed columns and converts money back to exact decimal strings. */
export function toDb(table: TableName, row: Row): Row {
  const out: Row = { ...row };
  delete out.user_id;
  delete out.created_at;
  delete out.updated_at;
  const m = MONEY_FIELDS[table];
  for (const f of m.required) if (f in out) out[f] = toDecimalString(Number(out[f]));
  for (const f of m.nullable) if (f in out) out[f] = out[f] === null || out[f] === undefined ? null : toDecimalString(Number(out[f]));
  for (const [k, v] of Object.entries(out)) if (v === "") out[k] = null;
  return out;
}

/** For backups: app rows -> DB shape (money as decimal strings), keeping ids and timestamps. */
export function toBackupRow(table: TableName, row: Row): Row {
  const out = toDb(table, row);
  if (row.created_at) out.created_at = row.created_at;
  return out;
}
