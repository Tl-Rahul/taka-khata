"use client";
import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, HandCoins, Handshake, Paperclip, Pencil, Repeat, Scale, Trash2, Undo2, Wallet, Search, SlidersHorizontal, X } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived, loanName } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { deleteReceipt } from "@/lib/data/receipts";
import { deltaFor, direction, grossAmount, applyFilters, EMPTY_FILTERS, type TxFilters } from "@/lib/finance/filters";
import { parseAmount } from "@/lib/finance/money";
import type { Transaction, TxType } from "@/lib/finance/types";
import { TX_TYPES } from "@/lib/finance/types";
import { useTxForm } from "./TxFormProvider";
import { useDeleteTx } from "./txActions";
import { AccountSelect, CategorySelect } from "./fields";
import { Button, Empty, IconButton, Input, Select, cx, useFeedback } from "./ui";

const TYPE_ICON: Record<TxType, React.ReactNode> = {
  expense: <ArrowUpRight />,
  income: <ArrowDownLeft />,
  transfer: <ArrowLeftRight />,
  lend: <Handshake />,
  borrow: <HandCoins />,
  debt_repayment: <Banknote />,
  collection: <Wallet />,
  refund: <Undo2 />,
  adjustment: <Scale />,
};

export function useTxLabel() {
  const { ds } = useData();
  const { accountMap, contactMap, loanMap, cmap } = useDerived();
  const { t, catName } = useI18n();
  return (tx: Transaction) => {
    const acc = accountMap.get(tx.account_id)?.name ?? "—";
    const cat = tx.category_id ? cmap.get(tx.category_id) : undefined;
    const parent = cat?.parent_id ? cmap.get(cat.parent_id) : undefined;
    const catLabel = cat ? (parent ? `${catName(parent)} › ${catName(cat)}` : catName(cat)) : "";
    const loan = tx.loan_id ? loanMap.get(tx.loan_id) : undefined;
    const who = loan ? loanName(loan, contactMap) : "";
    let title = tx.description || "";
    let sub = acc;
    switch (tx.type) {
      case "transfer":
        title ||= t("tx.transfer_to", { to: accountMap.get(tx.to_account_id ?? "")?.name ?? "—" });
        sub = `${acc} → ${accountMap.get(tx.to_account_id ?? "")?.name ?? "—"}`;
        break;
      case "income":
      case "expense":
      case "refund":
        title ||= catLabel || t(`type.${tx.type}`);
        sub = tx.description ? `${catLabel} · ${acc}` : acc;
        if (tx.type === "refund") sub = `${t("type.refund")} · ${sub}`;
        break;
      case "borrow":
      case "lend":
      case "debt_repayment":
      case "collection":
        title ||= `${t(`type.${tx.type}`)} — ${who}`;
        sub = tx.description ? `${t(`type.${tx.type}`)} · ${who} · ${acc}` : acc;
        break;
      case "adjustment":
        title ||= t("type.adjustment");
        break;
    }
    void ds;
    return { title, sub };
  };
}

export function TxRow({ tx, accountId, running, onEdit, onDelete }: { tx: Transaction; accountId?: string; running?: number; onEdit: () => void; onDelete: () => void }) {
  const { t, money } = useI18n();
  const label = useTxLabel();
  const { title, sub } = label(tx);
  const dir = direction(tx);
  const value = accountId ? deltaFor(tx, accountId) : dir === 0 ? grossAmount(tx) : dir * grossAmount(tx);
  const tone = accountId ? (value < 0 ? "text-neg" : "text-brand") : dir === 0 ? "text-ink" : dir < 0 ? "text-neg" : "text-brand";
  const iconTone = dir === 0 ? "bg-info-soft text-info" : dir < 0 ? "bg-neg-soft text-neg" : "bg-brand-soft text-brand";
  return (
    <li className="group flex scroll-mt-24 items-center gap-3 px-4 py-2.5 sm:px-5">
      <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", tx.type === "adjustment" ? "bg-surface-2 text-muted" : iconTone)}>{TYPE_ICON[tx.type]}</span>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[15px] font-medium leading-snug">{title}</p>
        <p className="flex items-center gap-1.5 truncate text-sm text-muted">
          {tx.recurring_id && <Repeat className="size-3.5 shrink-0" aria-label={t("tx.recurring")} />}
          {tx.attachment_path && <Paperclip className="size-3.5 shrink-0" aria-label={t("f.receipt")} />}
          <span className="truncate">{sub}</span>
        </p>
      </button>
      <div className="text-right">
        <p className={cx("num whitespace-nowrap text-[15px] font-semibold", tone)}>{accountId || dir !== 0 ? money(value, { signed: true }) : money(value)}</p>
        {(tx.interest > 0 || tx.fee > 0) && (
          <p className="num text-xs text-muted">
            {tx.interest > 0 && t("tx.incl_interest", { amount: money(tx.interest) })} {tx.fee > 0 && t("tx.incl_fee", { amount: money(tx.fee) })}
          </p>
        )}
        {running !== undefined && <p className="num text-xs text-muted">{money(running)}</p>}
      </div>
      <div className="hidden shrink-0 gap-0.5 sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <IconButton label={t("common.edit")} onClick={onEdit}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label={t("common.delete")} onClick={onDelete} className="hover:text-neg">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

/** Grouped-by-day list with "show more" paging. */
export function TransactionList({ txs, accountId, running, empty, pageSize = 60 }: { txs: Transaction[]; accountId?: string; running?: Map<string, number>; empty?: React.ReactNode; pageSize?: number }) {
  const { t, date } = useI18n();
  const { openTx } = useTxForm();
  const del = useDeleteTx();
  const [limit, setLimit] = useState(pageSize);
  const shown = txs.slice(0, limit);
  const groups = useMemo(() => {
    const g: Array<{ day: string; items: Transaction[] }> = [];
    for (const x of shown) {
      const last = g[g.length - 1];
      if (last && last.day === x.date) last.items.push(x);
      else g.push({ day: x.date, items: [x] });
    }
    return g;
  }, [shown]);
  if (!txs.length) return <>{empty ?? <Empty title={t("tx.empty")} />}</>;
  return (
    <div>
      {groups.map((g) => (
        <div key={g.day + g.items[0].id}>
          <div className="sticky top-14 z-10 bg-surface/95 px-4 py-1.5 text-xs font-semibold text-muted backdrop-blur sm:px-5">{date(g.day, "EEE, d MMM yyyy")}</div>
          <ul className="divide-y divide-line/70">
            {g.items.map((x) => (
              <TxRow key={x.id} tx={x} accountId={accountId} running={running?.get(x.id)} onEdit={() => openTx({ editing: x })} onDelete={() => del(x)} />
            ))}
          </ul>
        </div>
      ))}
      {txs.length > limit && (
        <div className="flex justify-center p-4">
          <Button variant="outline" onClick={() => setLimit((l) => l + pageSize)}>
            {t("common.show_more", { n: txs.length - limit })}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Search + filters bar. `lockTypes` hides the type filter (income/expense pages). */
export function FilterBar({ value, onChange, lockTypes, hideAccount }: { value: TxFilters; onChange: (f: TxFilters) => void; lockTypes?: boolean; hideAccount?: boolean }) {
  const { t } = useI18n();
  const { ds } = useData();
  const [open, setOpen] = useState(false);
  const [minS, setMinS] = useState(value.min !== null ? String(value.min / 100) : "");
  const [maxS, setMaxS] = useState(value.max !== null ? String(value.max / 100) : "");
  const active = (value.types.length && !lockTypes ? 1 : 0) + (value.accountId ? 1 : 0) + (value.categoryId ? 1 : 0) + (value.contactId ? 1 : 0) + (value.from || value.to ? 1 : 0) + (value.min !== null || value.max !== null ? 1 : 0);
  const catKind = value.types.length === 1 && value.types[0] === "income" ? "income" : "expense";
  const set = (p: Partial<TxFilters>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={value.q} onChange={(e) => set({ q: e.target.value })} placeholder={t("filter.search_ph")} className="pl-9" aria-label={t("filter.search")} />
        </div>
        <Button variant={active ? "secondary" : "outline"} onClick={() => setOpen((o) => !o)} icon={<SlidersHorizontal className="size-4" />} aria-expanded={open}>
          <span className="hidden sm:inline">{t("filter.filters")}</span>
          {active > 0 && <span className="num rounded-full bg-brand px-1.5 text-xs text-brand-ink">{active}</span>}
        </Button>
        <Select value={value.sort} onChange={(e) => set({ sort: e.target.value as TxFilters["sort"] })} className="w-auto" aria-label={t("filter.sort")}>
          <option value="date_desc">{t("sort.date_desc")}</option>
          <option value="date_asc">{t("sort.date_asc")}</option>
          <option value="amount_desc">{t("sort.amount_desc")}</option>
          <option value="amount_asc">{t("sort.amount_asc")}</option>
        </Select>
      </div>
      {open && (
        <div className="grid gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
          {!lockTypes && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              {t("filter.type")}
              <Select value={value.types[0] ?? ""} onChange={(e) => set({ types: e.target.value ? [e.target.value as TxType] : [] })}>
                <option value="">{t("filter.all_types")}</option>
                {TX_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`type.${x}`)}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {!hideAccount && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              {t("f.account")}
              <AccountSelect value={value.accountId} onChange={(id) => set({ accountId: id })} showBalance={false} placeholder={t("filter.all_accounts")} allowEmpty />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t("f.category")}
            <CategorySelect kind={catKind} value={value.categoryId} onChange={(id) => set({ categoryId: id })} placeholder={t("filter.all_categories")} allowEmpty />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t("filter.person")}
            <Select value={value.contactId} onChange={(e) => set({ contactId: e.target.value })}>
              <option value="">{t("filter.anyone")}</option>
              {ds.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t("filter.from")}
            <Input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t("filter.to")}
            <Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t("filter.min")}
            <Input inputMode="decimal" value={minS} onChange={(e) => { setMinS(e.target.value); set({ min: e.target.value ? parseAmount(e.target.value) : null }); }} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t("filter.max")}
            <Input inputMode="decimal" value={maxS} onChange={(e) => { setMaxS(e.target.value); set({ max: e.target.value ? parseAmount(e.target.value) : null }); }} />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              variant="ghost"
              size="sm"
              icon={<X className="size-4" />}
              onClick={() => {
                setMinS("");
                setMaxS("");
                onChange({ ...EMPTY_FILTERS, types: lockTypes ? value.types : [], q: value.q, sort: value.sort });
              }}
            >
              {t("filter.clear")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function useFilteredTransactions(f: TxFilters) {
  const { ds } = useData();
  const { accountMap } = useDerived();
  return useMemo(() => applyFilters(ds.transactions, f, { categories: ds.categories, loans: ds.loans, contacts: ds.contacts, accountsById: accountMap }), [ds.transactions, ds.categories, ds.loans, ds.contacts, accountMap, f]);
}
