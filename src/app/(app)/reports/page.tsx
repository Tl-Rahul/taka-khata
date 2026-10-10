"use client";
import { useMemo } from "react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived, loanName } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { summarize, rankCategories, computeBalances } from "@/lib/finance/engine";
import { monthlySeries, categoryByMonth, budgetVsActual } from "@/lib/finance/reports";
import { computeNetWorth, netWorthHistory } from "@/lib/finance/networth";
import { loanStatus } from "@/lib/finance/loans";
import { addMonths, monthStart, monthEnd } from "@/lib/finance/dates";
import { transactionsTable, type Table } from "@/lib/export";
import { Card, CardHeader, Empty, PageHeader, Stat, cx } from "@/components/ui";
import { PeriodPicker, usePeriod, periodLabel } from "@/components/PeriodPicker";
import { ExportMenu } from "@/components/ExportMenu";
import { BudgetActualChart, IncomeExpenseChart, NetWorthChart } from "@/components/charts";

function T({ head, rows, foot, numeric = [] }: { head: string[]; rows: Array<Array<string | number>>; foot?: Array<string | number>; numeric?: number[] }) {
  return (
    <div className="overflow-x-auto px-2 pb-3 sm:px-3">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left text-muted">
            {head.map((h, i) => (
              <th key={i} className={cx("px-2 py-1.5 font-medium", numeric.includes(i) && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line">
              {r.map((c, ci) => (
                <td key={ci} className={cx("px-2 py-1.5", numeric.includes(ci) && "num text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              {foot.map((c, ci) => (
                <td key={ci} className={cx("px-2 py-1.5", numeric.includes(ci) && "num text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const { ds, today } = useData();
  const { cmap, contactMap } = useDerived();
  const i = useI18n();
  const { t, money, pct, catName } = i;
  const [period, setPeriod] = usePeriod("reports", "month");
  const asOf = period.to < today ? period.to : today;

  const s = useMemo(() => summarize(ds, period.from, period.to), [ds, period]);
  const label = (id: string) => (cmap.get(id) ? catName(cmap.get(id)) : t(`syscat.${id.replace("sys:", "")}`));
  const trendFrom = period.kind === "month" ? monthStart(addMonths(period.from, -5)) : period.from;
  const trendTo = period.kind === "month" ? monthEnd(period.from) : period.to;
  const series = useMemo(() => monthlySeries(ds, trendFrom, trendTo), [ds, trendFrom, trendTo]);
  const cbm = useMemo(() => categoryByMonth(ds, trendFrom, trendTo), [ds, trendFrom, trendTo]);
  const bva = useMemo(() => budgetVsActual(ds, trendFrom, trendTo), [ds, trendFrom, trendTo]);
  const nwHist = useMemo(() => netWorthHistory(ds, trendFrom, trendTo < today ? trendTo : today, today), [ds, trendFrom, trendTo, today]);
  const nwEnd = useMemo(() => computeNetWorth(ds, asOf), [ds, asOf]);
  const balances = useMemo(() => computeBalances(ds.accounts, ds.transactions, asOf), [ds.accounts, ds.transactions, asOf]);
  const loans = useMemo(() => ds.loans.filter((l) => l.start_date <= asOf).map((l) => loanStatus(l, ds.transactions.filter((x) => x.date <= asOf), asOf)).filter((x) => x.outstanding > 0 || x.interestDue > 0), [ds.loans, ds.transactions, asOf]);

  const expenseRanked = rankCategories(s.expenseByTopCategory);
  const incomeRanked = rankCategories(s.incomeByTopCategory);
  const subRows = (top: string, leaf: Map<string, number>) => [...leaf.entries()].filter(([id, v]) => v && id !== top && cmap.get(id)?.parent_id === top).sort((a, b) => b[1] - a[1]);
  const hasData = s.txCount > 0;

  const buildExport = (): Table[] => {
    const tk = (p: number) => p / 100;
    return [
      {
        name: t("rep.sheet_summary"),
        header: [t("rep.item"), t("f.amount")],
        rows: [
          [t("rep.period"), periodLabel(period, i)],
          [t("sum.income"), tk(s.income)],
          [t("sum.expense"), tk(s.expense)],
          [t("sum.savings"), tk(s.savings)],
          [t("rep.savings_rate"), Number.isFinite(s.savingsRate) ? Math.round(s.savingsRate * 1000) / 10 : ""],
          [t("sum.cashflow"), tk(s.netCashFlow)],
          [t("nw.total_assets"), tk(nwEnd.totalAssets)],
          [t("nw.total_liabilities"), tk(nwEnd.totalLiabilities)],
          [t("nw.net_worth"), tk(nwEnd.netWorth)],
        ],
      },
      { name: t("rep.sheet_monthly"), header: [t("rep.month"), t("sum.income"), t("sum.expense"), t("sum.savings"), t("rep.savings_rate")], rows: series.map((r) => [r.month, tk(r.income), tk(r.expense), tk(r.savings), Number.isFinite(r.savingsRate) ? Math.round(r.savingsRate * 1000) / 10 : ""]) },
      { name: t("rep.sheet_expense_cat"), header: [t("f.category"), t("f.amount"), "%"], rows: expenseRanked.map(([id, v]) => [label(id), tk(v), Math.round((v / (s.expense || 1)) * 1000) / 10]) },
      { name: t("rep.sheet_income_cat"), header: [t("f.category"), t("f.amount"), "%"], rows: incomeRanked.map(([id, v]) => [label(id), tk(v), Math.round((v / (s.income || 1)) * 1000) / 10]) },
      { name: t("rep.sheet_compare"), header: [t("f.category"), ...cbm.months, t("rep.total")], rows: cbm.rows.map((r) => [label(r.categoryId), ...r.values.map(tk), tk(r.total)]) },
      { name: t("rep.sheet_accounts"), header: [t("f.account"), t("acc.balance")], rows: ds.accounts.map((a) => [a.name, tk(balances.get(a.id) ?? 0)]) },
      transactionsTable(
        ds.transactions.filter((x) => x.date >= period.from && x.date <= period.to).sort((a, b) => (a.date < b.date ? -1 : 1)),
        ds,
        t,
        catName,
      ),
    ];
  };

  return (
    <>
      <PageHeader
        title={t("nav.reports")}
        sub={t("rep.sub", { period: periodLabel(period, i) })}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <ExportMenu filename={`report-${period.from}-${period.to}`} build={buildExport} />
          </>
        }
      />
      <div className="hidden print:block print:mb-4">
        <h1 className="text-xl font-semibold">
          {t("app.name")} — {t("nav.reports")}: {periodLabel(period, i)}
        </h1>
      </div>

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5 sm:p-5">
        <Stat label={t("sum.income")} value={money(s.income)} tone="pos" />
        <Stat label={t("sum.expense")} value={money(s.expense)} tone="neg" />
        <Stat label={t("sum.savings")} value={money(s.savings)} tone={s.savings < 0 ? "neg" : "none"} />
        <Stat label={t("rep.savings_rate")} value={Number.isFinite(s.savingsRate) ? pct(s.savingsRate) : "—"} />
        <Stat label={t("nw.net_worth")} value={money(nwEnd.netWorth)} sub={t("rep.as_of", { date: i.date(asOf) })} />
      </Card>

      {!hasData && (
        <Card className="mt-4">
          <Empty title={t("rep.no_data")} body={t("rep.no_data_body")} />
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("chart.income_vs_expense")} sub={t("rep.trend_range")} />
          <div className="px-2 pb-3 sm:px-4">
            <IncomeExpenseChart data={series.map((r) => ({ label: i.month(r.month, true), income: r.income, expense: r.expense }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("nw.history")} />
          <div className="px-2 pb-3 sm:px-4">
            <NetWorthChart data={nwHist.map((h) => ({ ...h, label: i.month(h.month, true) }))} />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("rep.expense_by_category")} />
          {expenseRanked.length ? (
            <T
              head={[t("f.category"), t("f.amount"), "%"]}
              numeric={[1, 2]}
              rows={expenseRanked.flatMap(([id, v]) => [
                [label(id), money(v), pct(v / (s.expense || 1))],
                ...subRows(id, s.expenseByCategory).map(([sid, sv]) => [`  ↳ ${label(sid)}`, money(sv), pct(sv / (s.expense || 1))]),
              ])}
              foot={[t("rep.total"), money(s.expense), pct(1)]}
            />
          ) : (
            <Empty title={t("dash.no_expense")} />
          )}
        </Card>
        <Card>
          <CardHeader title={t("rep.income_by_category")} />
          {incomeRanked.length ? (
            <T head={[t("f.category"), t("f.amount"), "%"]} numeric={[1, 2]} rows={incomeRanked.map(([id, v]) => [label(id), money(v), pct(v / (s.income || 1))])} foot={[t("rep.total"), money(s.income), pct(1)]} />
          ) : (
            <Empty title={t("flow.no_income")} />
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t("rep.monthly_table")} />
        <T
          head={[t("rep.month"), t("sum.income"), t("sum.expense"), t("sum.savings"), t("rep.savings_rate"), t("sum.cashflow")]}
          numeric={[1, 2, 3, 4, 5]}
          rows={series.map((r) => [i.month(r.month), money(r.income), money(r.expense), money(r.savings), Number.isFinite(r.savingsRate) ? pct(r.savingsRate) : "—", money(r.netCashFlow, { signed: true })])}
        />
      </Card>

      {cbm.rows.length > 0 && (
        <Card className="mt-4">
          <CardHeader title={t("rep.compare_months")} />
          <T head={[t("f.category"), ...cbm.months.map((m) => i.month(m, true)), t("rep.total")]} numeric={cbm.months.map((_, k) => k + 1).concat(cbm.months.length + 1)} rows={cbm.rows.slice(0, 15).map((r) => [label(r.categoryId), ...r.values.map((v) => (v ? money(v) : "—")), money(r.total)])} />
        </Card>
      )}

      {ds.budgets.length > 0 && (
        <Card className="mt-4">
          <CardHeader title={t("chart.budget_vs_actual")} />
          <div className="px-2 pb-3 sm:px-4">
            <BudgetActualChart data={bva.map((r) => ({ ...r, label: i.month(r.month, true) }))} />
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("rep.balances_at", { date: i.date(asOf) })} />
          <T head={[t("f.account"), t("acc.balance")]} numeric={[1]} rows={ds.accounts.filter((a) => !a.archived || (balances.get(a.id) ?? 0) !== 0).map((a) => [a.name, money(balances.get(a.id) ?? 0)])} />
        </Card>
        <Card>
          <CardHeader title={t("rep.loans_at", { date: i.date(asOf) })} />
          {loans.length ? (
            <T
              head={[t("loan.col.person"), t("loan.col.type"), t("loan.outstanding"), t("loan.interest_due")]}
              numeric={[2, 3]}
              rows={loans.map((x) => [loanName(x.loan, contactMap), t(x.loan.direction === "borrowed" ? "loan.i_owe" : "loan.owed_to_me"), money(x.outstanding), money(x.interestDue)])}
              foot={[t("nw.debts_principal"), "", money(nwEnd.debtPrincipal), ""]}
            />
          ) : (
            <Empty title={t("rep.no_loans")} />
          )}
        </Card>
      </div>
    </>
  );
}
