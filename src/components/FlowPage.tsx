"use client";
import { useMemo, useState } from "react";
import { Plus, TrendingDown, TrendingUp } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { summarize, rankCategories, topCategoryId } from "@/lib/finance/engine";
import { monthlySeries, trendVsPrevious } from "@/lib/finance/reports";
import { shiftPeriod, monthStart, addMonths, monthEnd } from "@/lib/finance/dates";
import { EMPTY_FILTERS, type TxFilters } from "@/lib/finance/filters";
import { transactionsTable } from "@/lib/export";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardHeader, Dot, Empty, PageHeader, Stat, cx } from "./ui";
import { PeriodPicker, usePeriod } from "./PeriodPicker";
import { CategoryDonut } from "./charts";
import { FilterBar, TransactionList, useFilteredTransactions } from "./TransactionList";
import { ExportMenu } from "./ExportMenu";
import { useTxForm } from "./TxFormProvider";

/** Shared Income / Expenses page. */
export function FlowPage({ kind }: { kind: "income" | "expense" }) {
  const { ds } = useData();
  const { cmap } = useDerived();
  const i = useI18n();
  const { t, money, pct, catName } = i;
  const { openTx } = useTxForm();
  const [period, setPeriod] = usePeriod(kind);
  const [selectedCat, setSelectedCat] = useState<string>("");
  const isIncome = kind === "income";

  const cur = useMemo(() => summarize(ds, period.from, period.to), [ds, period]);
  const prevP = shiftPeriod(period, -1);
  const prev = useMemo(() => summarize(ds, prevP.from, prevP.to), [ds, prevP.from, prevP.to]);
  const total = isIncome ? cur.income : cur.expense;
  const prevTotal = isIncome ? prev.income : prev.expense;
  const byTop = isIncome ? cur.incomeByTopCategory : cur.expenseByTopCategory;
  const byLeaf = isIncome ? cur.incomeByCategory : cur.expenseByCategory;
  const label = (id: string) => (cmap.get(id) ? catName(cmap.get(id)) : t(`syscat.${id.replace("sys:", "")}`));
  const ranked = rankCategories(byTop);
  const trend = trendVsPrevious(byTop, isIncome ? prev.incomeByTopCategory : prev.expenseByTopCategory).filter((x) => x.change !== 0).slice(0, 5);

  const series = useMemo(() => {
    const end = period.kind === "month" ? monthEnd(period.from) : period.to;
    const from = period.kind === "month" ? monthStart(addMonths(period.from, -11)) : period.from;
    return monthlySeries(ds, from, end).map((r) => ({ label: i.month(r.month, true), v: (isIncome ? r.income : r.expense) / 100 }));
  }, [ds, period, isIncome, i]);

  const [extra, setExtra] = useState<TxFilters>({ ...EMPTY_FILTERS, types: isIncome ? ["income"] : ["expense", "refund"] });
  const listed = useFilteredTransactions({ ...extra, from: period.from, to: period.to, categoryId: selectedCat || extra.categoryId, types: extra.types });

  const subBreakdown = selectedCat
    ? [...byLeaf.entries()].filter(([id, v]) => v !== 0 && topCategoryId(id, cmap) === selectedCat).sort((a, b) => b[1] - a[1])
    : [];
  const change = prevTotal > 0 ? (total - prevTotal) / prevTotal : null;

  return (
    <>
      <PageHeader
        title={t(isIncome ? "nav.income" : "nav.expenses")}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <ExportMenu filename={kind} build={() => [transactionsTable(listed, ds, t, catName)]} />
            <Button icon={<Plus className="size-4" />} onClick={() => openTx({ preset: { type: kind } })}>
              {t(isIncome ? "qa.income" : "qa.expense")}
            </Button>
          </>
        }
      />

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <Stat label={t(isIncome ? "sum.income" : "sum.expense")} value={money(total)} tone={isIncome ? "pos" : "neg"} />
        <Stat
          label={t("flow.vs_previous")}
          value={change === null ? "—" : `${change > 0 ? "+" : ""}${pct(change)}`}
          tone={change === null ? "none" : (change > 0) === isIncome ? "pos" : "neg"}
          sub={t("flow.previous_was", { amount: money(prevTotal) })}
        />
        <Stat label={t("flow.top_category")} value={ranked[0] ? label(ranked[0][0]) : "—"} sub={ranked[0] ? money(ranked[0][1]) : undefined} />
        <Stat label={t("flow.daily_avg")} value={money(Math.round(total / Math.max(1, Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / 864e5) + 1)))} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title={t("flow.by_category")} sub={t("flow.tap_category")} />
          <div className="px-4 pb-4 sm:px-5">
            {ranked.length ? (
              <>
                <CategoryDonut items={ranked.map(([id, v]) => ({ id, label: label(id), value: v, color: cmap.get(id)?.color }))} total={total} centerLabel={t(isIncome ? "sum.income" : "sum.expense")} />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ranked.map(([id]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedCat((s) => (s === id ? "" : id))}
                      className={cx("rounded-full border px-2.5 py-1 text-sm", selectedCat === id ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink")}
                    >
                      {label(id)}
                    </button>
                  ))}
                </div>
                {selectedCat && subBreakdown.length > 0 && (
                  <ul className="mt-3 space-y-1 rounded-lg bg-surface-2 p-3 text-sm">
                    {subBreakdown.map(([id, v]) => (
                      <li key={id} className="flex justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <Dot color={cmap.get(id)?.color ?? cmap.get(selectedCat)?.color} />
                          {id === selectedCat ? t("flow.uncategorized_sub") : label(id)}
                        </span>
                        <span className="num">{money(v)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <Empty title={t(isIncome ? "flow.no_income" : "dash.no_expense")} />
            )}
          </div>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title={t("flow.trend")} />
          <div className="h-[220px] px-2 pb-3 sm:px-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(Math.round(v * 100), { short: true, symbol: false })} />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" }}
                  cursor={{ fill: "var(--surface-2)" }}
                  formatter={(v) => [money(Math.round(Number(v) * 100)), t(isIncome ? "sum.income" : "sum.expense")]}
                />
                <Bar dataKey="v" fill={isIncome ? "var(--brand)" : "var(--neg)"} radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {trend.length > 0 && (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <p className="mb-2 text-sm font-medium">{t("flow.biggest_changes")}</p>
              <ul className="space-y-1 text-sm">
                {trend.map((x) => (
                  <li key={x.categoryId} className="flex items-center justify-between gap-2">
                    <span>{label(x.categoryId)}</span>
                    <span className="flex items-center gap-2">
                      <span className="num text-muted">{money(x.previous)} → {money(x.current)}</span>
                      <Badge tone={(x.change > 0) === isIncome ? "pos" : "neg"}>
                        {x.change > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {money(Math.abs(x.change))}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <FilterBar value={extra} onChange={setExtra} lockTypes />
      </div>
      <Card className="mt-3 overflow-clip">
        <TransactionList txs={listed} empty={<Empty title={t(isIncome ? "flow.no_income" : "dash.no_expense")} />} />
      </Card>
    </>
  );
}
