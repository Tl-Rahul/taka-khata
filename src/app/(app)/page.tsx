"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Plus, Wallet, ListChecks } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived, loanName } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { summarize, rankCategories } from "@/lib/finance/engine";
import { monthlySeries } from "@/lib/finance/reports";
import { billsOverview } from "@/lib/finance/recurring";
import { budgetRows } from "@/lib/finance/budgets";
import { addDays, addMonths, monthStart, monthEnd } from "@/lib/finance/dates";
import { compareTxDesc } from "@/lib/finance/engine";
import { accountColor } from "@/lib/accountMeta";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Progress, Stat, cx } from "@/components/ui";
import { PeriodPicker, usePeriod } from "@/components/PeriodPicker";
import { CategoryDonut, IncomeExpenseChart, MoneyMap } from "@/components/charts";
import { TransactionList } from "@/components/TransactionList";
import { useTxForm } from "@/components/TxFormProvider";
import { useNotices, noticeText } from "@/components/NotificationBell";

export default function Dashboard() {
  const { ds, today } = useData();
  const d = useDerived();
  const i = useI18n();
  const { t, money, pct, date, catName } = i;
  const { openQuickAdd } = useTxForm();
  const [period, setPeriod] = usePeriod("dashboard");
  const { visible: notices } = useNotices();

  const s = useMemo(() => summarize(ds, period.from, period.to), [ds, period]);
  const series = useMemo(() => {
    const from = period.kind === "month" ? monthStart(addMonths(period.from, -5)) : period.from;
    return monthlySeries(ds, from, period.kind === "month" ? monthEnd(period.from) : period.to).map((r) => ({ label: i.month(r.month, true), income: r.income, expense: r.expense }));
  }, [ds, period, i]);
  const donut = useMemo(
    () =>
      rankCategories(s.expenseByTopCategory).map(([id, v]) => {
        const c = d.cmap.get(id);
        return { id, label: c ? catName(c) : t(`syscat.${id.replace("sys:", "")}`), value: v, color: c?.color };
      }),
    [s, d.cmap, catName, t],
  );
  const bills = useMemo(() => billsOverview(ds.recurring, ds.transactions, today, 14), [ds.recurring, ds.transactions, today]);
  const upcomingLoans = useMemo(
    () =>
      [...d.loanStatuses.values()]
        .filter((x) => !x.isSettled && x.nextDue && x.nextDue.date <= addDays(today, 14))
        .sort((a, b) => (a.nextDue!.date < b.nextDue!.date ? -1 : 1)),
    [d.loanStatuses, today],
  );
  const budgets = useMemo(() => budgetRows(ds, today), [ds, today]);
  const recent = useMemo(() => [...ds.transactions].sort(compareTxDesc).slice(0, 8), [ds.transactions]);
  const nw = d.nw;

  if (!ds.accounts.length) {
    return (
      <>
        <PageHeader title={t("dash.welcome")} sub={t("dash.welcome_sub")} />
        <Card className="p-5 sm:p-6">
          <ol className="space-y-4">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-3">
                <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{i.digits(n)}</span>
                <div>
                  <p className="font-medium">{t(`onboard.${n}.title`)}</p>
                  <p className="text-sm text-muted">{t(`onboard.${n}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link href="/accounts?new=1" className="mt-6 inline-flex">
            <Button icon={<Wallet className="size-4" />}>{t("acc.add_first")}</Button>
          </Link>
        </Card>
      </>
    );
  }

  const upcoming = [
    ...bills.overdue.map((o) => ({ key: `b${o.recurring.id}${o.date}`, name: o.recurring.name, date: o.date, amount: o.amount, overdue: true, href: "/bills", kind: o.recurring.kind })),
    ...bills.dueSoon.concat(bills.upcoming).map((o) => ({ key: `b${o.recurring.id}${o.date}`, name: o.recurring.name, date: o.date, amount: o.amount, overdue: false, href: "/bills", kind: o.recurring.kind })),
    ...upcomingLoans.map((x) => ({
      key: `l${x.loan.id}`,
      name: `${t(x.loan.direction === "borrowed" ? "dash.pay_to" : "dash.collect_from", { name: loanName(x.loan, d.contactMap) })}`,
      date: x.nextDue!.date,
      amount: x.nextDue!.amount,
      overdue: x.isOverdue,
      href: `/${x.loan.direction === "borrowed" ? "debts" : "receivables"}/${x.loan.id}`,
      kind: x.loan.direction === "borrowed" ? "expense" : "income",
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <>
      <PageHeader title={t("dash.title")} actions={<PeriodPicker value={period} onChange={setPeriod} />} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* signature: where the money is */}
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted">{t("dash.available")}</p>
              <p className={cx("num text-3xl font-semibold sm:text-4xl", nw.availableBalance < 0 && "text-neg")}>{money(nw.availableBalance)}</p>
            </div>
            <Link href="/accounts" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
              {t("dash.all_accounts")} <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-4">
            <MoneyMap items={d.activeAccounts.filter((a) => a.type !== "credit_card").map((a) => ({ id: a.id, label: a.name, value: d.balances.get(a.id) ?? 0, color: accountColor(a) }))} />
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <Link href="/net-worth" className="block">
            <p className="text-sm text-muted">{t("nw.net_worth")}</p>
            <p className={cx("num text-2xl font-semibold", nw.netWorth < 0 ? "text-neg" : "text-ink")}>{money(nw.netWorth)}</p>
          </Link>
          <dl className="mt-3 space-y-1.5 text-sm">
            {[
              ["nw.assets", nw.totalAssets, ""],
              ["nw.liabilities", nw.totalLiabilities, "text-neg"],
              ["dash.debts", nw.debtPrincipal + nw.debtInterestDue, ""],
              ["dash.receivables", nw.receivables, ""],
            ].map(([k, v, cls]) => (
              <div key={k as string} className="flex justify-between gap-2">
                <dt className="text-muted">{t(k as string)}</dt>
                <dd className={cx("num font-medium", cls as string)}>{money(v as number)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card className="mt-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <Stat label={t("sum.income")} value={money(s.income)} tone="pos" />
        <Stat label={t("sum.expense")} value={money(s.expense)} tone="neg" />
        <Stat label={t("sum.savings")} value={money(s.savings)} tone={s.savings < 0 ? "neg" : "none"} sub={Number.isFinite(s.savingsRate) ? t("sum.savings_rate", { pct: pct(s.savingsRate) }) : undefined} />
        <Stat label={t("sum.cashflow")} value={money(s.netCashFlow, { signed: true })} tone={s.netCashFlow < 0 ? "neg" : "pos"} sub={t("sum.cashflow_hint")} />
      </Card>

      {notices.some((n) => n.severity !== "info") && (
        <Card className="mt-4">
          <CardHeader title={t("dash.attention")} />
          <ul className="divide-y divide-line px-1 pb-2">
            {notices
              .filter((n) => n.severity !== "info")
              .slice(0, 5)
              .map((n) => {
                const txt = noticeText(n, i, ds);
                return (
                  <li key={n.id}>
                    <Link href={n.href} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2 sm:px-4">
                      <span className={cx("size-2 shrink-0 rounded-full", n.severity === "danger" ? "bg-neg" : "bg-warn")} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium">{txt.title}</span>
                        <span className="num block text-sm text-muted">{txt.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t("chart.income_vs_expense")} />
          <div className="px-2 pb-3 sm:px-4">{series.some((r) => r.income || r.expense) ? <IncomeExpenseChart data={series} /> : <Empty title={t("chart.no_data")} />}</div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("dash.spending_by_category")} />
          <div className="px-4 pb-4 sm:px-5">{donut.length ? <CategoryDonut items={donut} total={s.expense} centerLabel={t("sum.expense")} /> : <Empty title={t("dash.no_expense")} />}</div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("dash.upcoming")}
            sub={t("dash.upcoming_sub")}
            action={
              <Link href="/bills" className="text-sm text-brand hover:underline">
                {t("nav.bills")}
              </Link>
            }
          />
          {upcoming.length ? (
            <ul className="divide-y divide-line px-1 pb-2">
              {upcoming.slice(0, 7).map((u) => (
                <li key={u.key}>
                  <Link href={u.href} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2 sm:px-4">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{u.name}</span>
                      <span className="num text-sm text-muted">{date(u.date)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {u.overdue && <Badge tone="neg">{t("status.overdue")}</Badge>}
                      <span className={cx("num font-semibold", u.kind === "income" ? "text-brand" : "")}>{money(u.amount)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t("dash.nothing_due")} body={t("dash.nothing_due_body")} />
          )}
        </Card>

        <Card>
          <CardHeader
            title={t("dash.budget_status")}
            sub={i.month(today.slice(0, 7))}
            action={
              <Link href="/budgets" className="text-sm text-brand hover:underline">
                {t("nav.budgets")}
              </Link>
            }
          />
          {budgets.length ? (
            <ul className="space-y-3 px-4 pb-4 sm:px-5">
              {budgets.slice(0, 5).map((b) => (
                <li key={b.budget.id}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{b.category ? catName(b.category) : t("budget.overall")}</span>
                    <span className="num text-muted">
                      {money(b.spent)} / {money(b.budget.amount)}
                    </span>
                  </div>
                  <Progress ratio={b.ratio} tone={b.level === "over" ? "neg" : b.level === "ok" ? "pos" : "warn"} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={<ListChecks />}
              title={t("dash.no_budget")}
              action={
                <Link href="/budgets">
                  <Button variant="outline" size="sm">
                    {t("budget.set")}
                  </Button>
                </Link>
              }
            />
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t("dash.recent")}
          action={
            <Link href="/transactions" className="text-sm text-brand hover:underline">
              {t("common.see_all")}
            </Link>
          }
        />
        <TransactionList
          txs={recent}
          pageSize={8}
          empty={
            <Empty
              title={t("tx.empty")}
              body={t("tx.empty_body")}
              action={
                <Button onClick={openQuickAdd} icon={<Plus className="size-4" />}>
                  {t("qa.button")}
                </Button>
              }
            />
          }
        />
      </Card>
    </>
  );
}
