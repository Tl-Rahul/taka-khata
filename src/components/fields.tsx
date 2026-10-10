"use client";
import { forwardRef, useMemo, useState, type InputHTMLAttributes } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { parseAmount } from "@/lib/finance/money";
import type { Account, Category, CategoryKind, Contact } from "@/lib/finance/types";
import { cx, Input, Select } from "./ui";

/** Money input: Bangla/Latin digits, commas and simple sums (120+45). */
export const AmountInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & { value: string; onChange: (v: string) => void; invalid?: boolean; allowNegative?: boolean; big?: boolean }
>(function AmountInput({ value, onChange, invalid, allowNegative, big, className, ...rest }, ref) {
  const { money } = useI18n();
  const parsed = parseAmount(value, { allowNegative });
  const isExpr = /\d\s*[-+]\s*\d/.test(value);
  return (
    <div>
      <div className="relative">
        <span className={cx("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted", big && "text-xl")}>৳</span>
        <Input
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          invalid={invalid}
          className={cx("num pl-7", big && "h-14 text-2xl font-semibold", className)}
          {...rest}
        />
      </div>
      {isExpr && parsed !== null && <p className="mt-1 text-xs text-muted num">= {money(parsed, { compactZeros: false })}</p>}
    </div>
  );
});

export interface CategoryOption {
  id: string;
  label: string;
  depth: 0 | 1;
  category: Category;
}

export function useCategoryOptions(kind: CategoryKind, includeArchivedId?: string | null, includeSystem = false): CategoryOption[] {
  const { ds } = useData();
  const { catName } = useI18n();
  return useMemo(() => {
    const pool = ds.categories.filter(
      (c) => c.kind === kind && (!c.archived || c.id === includeArchivedId) && (includeSystem || !c.system_key || c.id === includeArchivedId),
    );
    const parents = pool.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const out: CategoryOption[] = [];
    for (const p of parents) {
      out.push({ id: p.id, label: catName(p), depth: 0, category: p });
      for (const c of pool.filter((x) => x.parent_id === p.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
        out.push({ id: c.id, label: catName(c), depth: 1, category: c });
    }
    // orphans (parent archived)
    for (const c of pool) if (c.parent_id && !out.some((o) => o.id === c.id)) out.push({ id: c.id, label: catName(c), depth: 1, category: c });
    return out;
  }, [ds.categories, kind, includeArchivedId, includeSystem, catName]);
}

export function CategorySelect({
  kind,
  value,
  onChange,
  invalid,
  id,
  placeholder,
  includeSystem,
  allowEmpty,
}: {
  kind: CategoryKind;
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  id?: string;
  placeholder?: string;
  includeSystem?: boolean;
  allowEmpty?: boolean;
}) {
  const { t } = useI18n();
  const opts = useCategoryOptions(kind, value, includeSystem ?? true);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="" disabled={!allowEmpty}>
        {placeholder ?? t("f.choose_category")}
      </option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.depth ? `   ↳ ${o.label}` : o.label}
        </option>
      ))}
    </Select>
  );
}

export function AccountSelect({
  value,
  onChange,
  invalid,
  id,
  exclude,
  showBalance = true,
  placeholder,
  allowEmpty,
}: {
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  id?: string;
  exclude?: string;
  showBalance?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const { t, money } = useI18n();
  const { ds } = useData();
  const { balances } = useDerived();
  const accounts = ds.accounts
    .filter((a) => (!a.archived || a.id === value) && a.id !== exclude)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <option value="" disabled={!allowEmpty}>
        {placeholder ?? t("f.choose_account")}
      </option>
      {accounts.map((a: Account) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {showBalance ? ` — ${money(balances.get(a.id) ?? 0)}` : ""}
        </option>
      ))}
    </Select>
  );
}

/** Type a person's name: picks an existing contact or creates a new one on save. */
export function ContactInput({ value, onChange, id, invalid, placeholder }: { value: string; onChange: (name: string) => void; id?: string; invalid?: boolean; placeholder?: string }) {
  const { ds } = useData();
  const listId = (id ?? "contact") + "-list";
  return (
    <>
      <Input id={id} list={listId} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} placeholder={placeholder} autoComplete="off" />
      <datalist id={listId}>
        {ds.contacts.map((c: Contact) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </>
  );
}

export function findContactByName(contacts: Contact[], name: string): Contact | undefined {
  const n = name.trim().toLowerCase();
  return contacts.find((c) => c.name.trim().toLowerCase() === n);
}

/** Small controlled text state helper for numeric fields that keeps the user's raw input. */
export function useAmountState(initial: number | null | undefined) {
  const [v, setV] = useState(initial ? String(initial / 100) : "");
  return [v, setV] as const;
}
