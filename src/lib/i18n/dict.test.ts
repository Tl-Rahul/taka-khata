import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DICT, ALL_KEYS } from "./dict";
import { ACCOUNT_TYPES, ASSET_CATEGORIES, FREQUENCIES, LIABILITY_CATEGORIES, TX_TYPES } from "@/lib/finance/types";
import { IMPORT_FIELDS } from "@/lib/finance/importer";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

describe("translations", () => {
  const prefixes = new Set(ALL_KEYS.map((k) => k.split(".")[0]));
  const src = walk(path.resolve(__dirname, "../..")).map((f) => fs.readFileSync(f, "utf8")).join("\n");

  it("every key used in the source exists", () => {
    const used = new Set<string>();
    for (const m of src.matchAll(/["'`]([a-z_]+(?:\.[a-z0-9_]+)+)["'`:]/g)) {
      const k = m[1];
      if (prefixes.has(k.split(".")[0]) && !/\.(xlsx|csv|json|svg|png|ts|tsx)$/.test(k)) used.add(k);
    }
    const dynamic = [
      ...TX_TYPES.flatMap((x) => [`type.${x}`, `tx.title.${x}`, `tx.edit.${x}`, `tx.save.${x}`, `ph.desc.${x}`, `qa.${x}`]),
      ...ACCOUNT_TYPES.map((x) => `acctype.${x}`),
      ...FREQUENCIES.flatMap((x) => [`freq.${x}`, `freq_unit.${x}`]),
      ...["paid", "partial", "due", "overdue", "upcoming"].map((x) => `inst.${x}`),
      ...["bill_overdue", "bill_due", "installment_overdue", "installment_due", "receivable_overdue", "receivable_due"].map((x) => `notice.${x}`),
      ...["interest_paid", "fees", "interest_received"].map((x) => `syscat.${x}`),
      ...["warn75", "warn90", "over"].map((x) => `budget.level.${x}`),
      ...[...ASSET_CATEGORIES, ...LIABILITY_CATEGORIES].map((x) => `hold.cat.${x}`),
      ...["person", "title", "start", "due", "principal", "paid", "outstanding", "interest_due", "status"].map((x) => `loan.col.${x}`),
      ...["date", "type", "amount", "interest", "fee", "account", "to_account", "category", "subcategory", "person", "description", "notes"].map((x) => `export.col.${x}`),
      ...IMPORT_FIELDS.map((x) => `import.field.${x}`),
      ...["signin", "signup", "reset"].flatMap((x) => [`auth.title.${x}`, `auth.submit.${x}`]),
      ...[1, 2, 3].flatMap((n) => [`onboard.${n}.title`, `onboard.${n}.body`]),
    ];
    const missing = [...used, ...dynamic].filter((k) => !(k in DICT.en));
    expect(missing).toEqual([]);
  });

  it("both languages have a non-empty string for every key", () => {
    for (const k of ALL_KEYS) {
      expect(DICT.bn[k], k).toBeTruthy();
      expect(DICT.en[k], k).toBeTruthy();
    }
  });

  it("placeholders match between languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad = ALL_KEYS.filter((k) => ph(DICT.bn[k]) !== ph(DICT.en[k]));
    expect(bad).toEqual([]);
  });
});
