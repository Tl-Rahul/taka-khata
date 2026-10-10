"use client";
import Papa from "papaparse";
import type { Dataset, Transaction } from "@/lib/finance/types";
import { categoryMap } from "@/lib/finance/engine";
import { toDecimalString } from "@/lib/finance/money";
import { toBackupRow } from "@/lib/data/mapping";
import type { TableName } from "@/lib/finance/types";

export type Cell = string | number | null;
export interface Table {
  name: string;
  header: string[];
  rows: Cell[][];
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** CSV with a BOM so Excel opens Bangla text correctly. */
export function downloadCSV(table: Table, filename: string) {
  const csv = Papa.unparse({ fields: table.header, data: table.rows.map((r) => r.map((c) => (c === null ? "" : c))) });
  downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), filename);
}

export async function downloadXLSX(tables: Table[], filename: string) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const sheets = tables.map((t) => ({
    sheet: t.name.slice(0, 31),
    data: [t.header.map((h) => ({ value: h, fontWeight: "bold" as const })), ...t.rows.map((r) => r.map((c) => (c === null ? null : { value: c })))],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeExcelFile as any)(sheets).toFile(filename);
}

/** Readable transaction table. Amounts are in taka (decimal), not paisa. */
export function transactionsTable(txs: Transaction[], ds: Dataset, label: (k: string) => string, catName: (c: ReturnType<ReturnType<typeof categoryMap>["get"]>) => string): Table {
  const cmap = categoryMap(ds.categories);
  const acc = new Map(ds.accounts.map((a) => [a.id, a.name]));
  const loanContact = new Map(ds.loans.map((l) => [l.id, l.contact_id]));
  const contact = new Map(ds.contacts.map((c) => [c.id, c.name]));
  const taka = (p: number) => Number(toDecimalString(p));
  return {
    name: label("export.sheet_transactions"),
    header: ["date", "type", "amount", "interest", "fee", "account", "to_account", "category", "subcategory", "person", "description", "notes"].map((h) => label(`export.col.${h}`)),
    rows: txs.map((t) => {
      const c = t.category_id ? cmap.get(t.category_id) : undefined;
      const parent = c?.parent_id ? cmap.get(c.parent_id) : undefined;
      const person = t.loan_id ? contact.get(loanContact.get(t.loan_id) ?? "") : t.contact_id ? contact.get(t.contact_id) : "";
      return [
        t.date,
        label(`type.${t.type}`),
        taka(t.amount),
        t.interest ? taka(t.interest) : null,
        t.fee ? taka(t.fee) : null,
        acc.get(t.account_id) ?? "",
        t.to_account_id ? acc.get(t.to_account_id) ?? "" : "",
        parent ? catName(parent) : c ? catName(c) : "",
        parent && c ? catName(c) : "",
        person ?? "",
        t.description ?? "",
        t.notes ?? "",
      ];
    }),
  };
}

const BACKUP_TABLES: TableName[] = ["contacts", "accounts", "categories", "loans", "recurring", "transactions", "budgets", "goals", "goal_entries", "holdings", "holding_valuations"];

/** Complete backup in database format; restorable with the restore_backup() function. */
export function buildBackup(ds: Dataset) {
  const out: Record<string, unknown> = {
    app: "personal-finance",
    version: 1,
    exported_at: new Date().toISOString(),
    profile: ds.profile
      ? {
          display_name: ds.profile.display_name,
          locale: ds.profile.locale,
          date_format: ds.profile.date_format,
          bangla_digits: ds.profile.bangla_digits,
          theme: ds.profile.theme,
          week_start: ds.profile.week_start,
          reminders: ds.profile.reminders,
        }
      : null,
  };
  for (const t of BACKUP_TABLES) out[t] = (ds[t] as unknown as Record<string, unknown>[]).map((r) => toBackupRow(t, r));
  return out;
}

export function validateBackup(json: unknown): { ok: true; counts: Record<string, number> } | { ok: false; error: string } {
  if (!json || typeof json !== "object") return { ok: false, error: "backup.err.not_json" };
  const j = json as Record<string, unknown>;
  if (j.app !== "personal-finance") return { ok: false, error: "backup.err.wrong_app" };
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    if (j[t] !== undefined && !Array.isArray(j[t])) return { ok: false, error: "backup.err.corrupt" };
    counts[t] = Array.isArray(j[t]) ? (j[t] as unknown[]).length : 0;
  }
  return { ok: true, counts };
}
