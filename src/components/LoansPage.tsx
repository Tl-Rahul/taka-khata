"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { HandCoins, Handshake, History, Plus } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { loanTotals, type LoanStatus } from "@/lib/finance/loans";
import type { LoanDirection } from "@/lib/finance/types";
import { Badge, Button, Card, Empty, Modal, PageHeader, Progress, Segmented, Stat, cx } from "./ui";
import { LoanForm } from "./LoanForm";
import { useTxForm } from "./TxFormProvider";
import { ExportMenu } from "./ExportMenu";

export function LoanStatusBadge({ s }: { s: LoanStatus }) {
  const { t, digits } = useI18n();
  if (s.loan.closed) return <Badge>{t("loan.status.closed")}</Badge>;
  if (s.isSettled) return <Badge tone="pos">{t("loan.status.settled")}</Badge>;
  if (s.isOverdue) return <Badge tone="neg">{t("loan.status.overdue_days", { n: digits(s.daysOverdue) })}</Badge>;
  return <Badge tone="info">{t("loan.status.active")}</Badge>;
}

export function LoansPage({ direction }: { direction: LoanDirection }) {
  const { ds } = useData();
  const { loanStatuses, contactMap } = useDerived();
  const { t, money, date } = useI18n();
  const { openTx } = useTxForm();
  const [show, setShow] = useState<"active" | "settled" | "all">("active");
  const [form, setForm] = useState(false);
  const borrowed = direction === "borrowed";
  const base = borrowed ? "/debts" : "/receivables";

  const statuses = useMemo(() => ds.loans.filter((l) => l.direction === direction).map((l) => loanStatuses.get(l.id)!).filter(Boolean), [ds.loans, direction, loanStatuses]);
  const totals = loanTotals(statuses);
  const visible = statuses.filter((s) => (show === "all" ? true : show === "active" ? !s.isSettled : s.isSettled));
  const byPerson = useMemo(() => {
    const m = new Map<string, LoanStatus[]>();
    for (const s of visible) {
      const arr = m.get(s.loan.contact_id) ?? [];
      arr.push(s);
      m.set(s.loan.contact_id, arr);
    }
    return [...m.entries()]
      .map(([cid, items]) => ({ cid, name: contactMap.get(cid)?.name ?? "—", items: items.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || (a.loan.start_date < b.loan.start_date ? 1 : -1)), outstanding: items.reduce((a, s) => a + s.outstanding + s.interestDue, 0) }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [visible, contactMap]);

  const exportTable = () => [
    {
      name: t(borrowed ? "nav.debts" : "nav.receivables"),
      header: ["person", "title", "start", "due", "principal", "paid", "outstanding", "interest_due", "status"].map((h) => t(`loan.col.${h}`)),
      rows: statuses.map((s) => [
        contactMap.get(s.loan.contact_id)?.name ?? "",
        s.loan.title ?? "",
        s.loan.start_date,
        s.nextDue?.date ?? s.loan.due_date ?? "",
        s.principalTotal / 100,
        s.principalPaid / 100,
        s.outstanding / 100,
        s.interestDue / 100,
        s.loan.closed ? t("loan.status.closed") : s.isSettled ? t("loan.status.settled") : s.isOverdue ? t("status.overdue") : t("loan.status.active"),
      ]),
    },
  ];

  return (
    <>
      <PageHeader
        title={t(borrowed ? "nav.debts" : "nav.receivables")}
        sub={t(borrowed ? "loan.debts_sub" : "loan.rec_sub")}
        actions={
          <>
            <ExportMenu filename={borrowed ? "debts" : "receivables"} build={exportTable} />
            <Button variant="outline" icon={<History className="size-4" />} onClick={() => setForm(true)}>
              {t("loan.add_existing")}
            </Button>
            <Button icon={borrowed ? <HandCoins className="size-4" /> : <Handshake className="size-4" />} onClick={() => openTx({ preset: { type: borrowed ? "borrow" : "lend" } })}>
              {t(borrowed ? "qa.borrow" : "qa.lend")}
            </Button>
          </>
        }
      />
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <Stat label={t(borrowed ? "loan.total_owe" : "loan.total_owed_to_me")} value={money(totals.outstanding)} tone={borrowed ? "neg" : "pos"} />
        <Stat label={t(borrowed ? "loan.interest_unpaid" : "loan.interest_expected")} value={money(totals.interestDue)} />
        <Stat label={t("loan.active_count")} value={totals.activeCount} />
        <Stat label={t("loan.overdue_count")} value={totals.overdueCount} tone={totals.overdueCount ? "neg" : "none"} />
      </Card>

      <div className="mt-4 mb-3">
        <Segmented
          size="sm"
          value={show}
          onChange={setShow}
          options={[
            { value: "active", label: t("loan.filter.active") },
            { value: "settled", label: t("loan.filter.settled") },
            { value: "all", label: t("loan.filter.all") },
          ]}
        />
      </div>

      {byPerson.length === 0 ? (
        <Card>
          <Empty
            title={t(statuses.length ? "loan.none_in_filter" : borrowed ? "loan.none_debts" : "loan.none_receivables")}
            body={statuses.length ? undefined : t(borrowed ? "loan.empty_debts_body" : "loan.empty_rec_body")}
            action={
              !statuses.length && (
                <Button icon={<Plus className="size-4" />} onClick={() => openTx({ preset: { type: borrowed ? "borrow" : "lend" } })}>
                  {t(borrowed ? "qa.borrow" : "qa.lend")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {byPerson.map((g) => (
            <Card key={g.cid} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5 sm:px-5">
                <h2 className="font-semibold">{g.name}</h2>
                <span className={cx("num text-sm font-semibold", borrowed ? "text-neg" : "text-brand")}>{money(g.outstanding)}</span>
              </div>
              <ul className="divide-y divide-line">
                {g.items.map((s) => (
                  <li key={s.loan.id}>
                    <Link href={`${base}/${s.loan.id}`} className="block px-4 py-3 hover:bg-surface-2 sm:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.loan.title || t("loan.since", { date: date(s.loan.start_date) })}</p>
                          <p className="text-sm text-muted">
                            {s.nextDue ? t("loan.next_due", { date: date(s.nextDue.date), amount: money(s.nextDue.amount) }) : s.lastPaymentDate ? t("loan.last_payment", { date: date(s.lastPaymentDate) }) : t("loan.no_payment_yet")}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="num font-semibold">{money(s.outstanding)}</p>
                          {s.interestDue > 0 && <p className="num text-xs text-muted">+ {t("loan.interest_short", { amount: money(s.interestDue) })}</p>}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <Progress ratio={s.principalTotal ? s.principalPaid / s.principalTotal : 0} tone={s.isOverdue ? "neg" : "pos"} className="flex-1" label={t("loan.repaid_progress")} />
                        <LoanStatusBadge s={s} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Modal open={form} onClose={() => setForm(false)} title={t(borrowed ? "loan.add_existing_debt" : "loan.add_existing_rec")}>
        {form && <LoanForm direction={direction} onCancel={() => setForm(false)} onDone={() => setForm(false)} />}
      </Modal>
    </>
  );
}
