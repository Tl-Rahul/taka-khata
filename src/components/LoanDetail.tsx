"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleCheck, Pencil, Plus, RotateCcw, Trash2, Wallet, Banknote } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { compareTxDesc } from "@/lib/finance/engine";
import type { Loan, LoanDirection } from "@/lib/finance/types";
import { Badge, Button, Card, CardHeader, Empty, Modal, PageHeader, Progress, Stat, cx, useFeedback } from "./ui";
import { LoanForm } from "./LoanForm";
import { LoanStatusBadge } from "./LoansPage";
import { TransactionList } from "./TransactionList";
import { useTxForm } from "./TxFormProvider";

export function LoanDetail({ id, direction }: { id: string; direction: LoanDirection }) {
  const { ds, update, remove } = useData();
  const { loanStatuses, contactMap } = useDerived();
  const i = useI18n();
  const { t, money, date, num } = i;
  const { openTx } = useTxForm();
  const { confirm, toast } = useFeedback();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const borrowed = direction === "borrowed";
  const base = borrowed ? "/debts" : "/receivables";
  const loan = ds.loans.find((l) => l.id === id && l.direction === direction);
  const s = loan ? loanStatuses.get(loan.id) : undefined;
  if (!loan || !s) return <Empty title={t("loan.not_found")} action={<Link href={base} className="text-brand hover:underline">{t(borrowed ? "nav.debts" : "nav.receivables")}</Link>} />;
  const person = contactMap.get(loan.contact_id)?.name ?? "—";
  const txs = [...s.transactions].sort(compareTxDesc);

  const toggleClosed = async () => {
    if (!loan.closed && (s.outstanding > 0 || s.interestDue > 0)) {
      const ok = await confirm({ title: t("loan.close_title"), body: t(borrowed ? "loan.close_body_debt" : "loan.close_body_rec", { amount: money(s.outstanding + s.interestDue) }), confirmLabel: t("loan.close"), cancelLabel: t("common.cancel") });
      if (!ok) return;
    }
    try {
      await update<Loan>("loans", loan.id, { closed: !loan.closed });
      toast(t(loan.closed ? "toast.loan_reopened" : "toast.loan_closed"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };
  const del = async () => {
    const ok = await confirm({
      title: t("loan.delete_title"),
      body: t("loan.delete_body", { n: s.transactions.length }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!ok) return;
    try {
      await remove("loans", loan.id);
      toast(t("toast.loan_deleted"));
      router.push(base);
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const intLabel =
    loan.interest_type === "none"
      ? t("loan.int.none")
      : loan.interest_type === "fixed"
        ? `${t("loan.int.fixed")}: ${money(loan.fixed_interest ?? 0)}`
        : `${t("loan.int.simple_annual")}: ${num(loan.interest_rate ?? 0, 3)}%`;

  return (
    <>
      <Link href={base} className="no-print mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {t(borrowed ? "nav.debts" : "nav.receivables")}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {person}
            <LoanStatusBadge s={s} />
          </span>
        }
        sub={[loan.title, t("loan.since", { date: date(loan.start_date) })].filter(Boolean).join(" · ")}
        actions={
          <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            {t("loan.edit")}
          </Button>
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={t("loan.outstanding")} value={money(s.outstanding)} tone={borrowed ? "neg" : "pos"} />
          <Stat label={t("loan.original")} value={money(s.principalTotal)} sub={loan.opening_principal > 0 ? t("loan.incl_opening", { amount: money(loan.opening_principal) }) : undefined} />
          <Stat label={t(borrowed ? "loan.principal_repaid" : "loan.principal_collected")} value={money(s.principalPaid)} />
          <Stat label={t("loan.interest_due")} value={money(s.interestDue)} sub={t("loan.interest_paid_so_far", { amount: money(s.interestPaid) })} />
        </div>
        <Progress className="mt-4" ratio={s.principalTotal ? s.principalPaid / s.principalTotal : 0} tone={s.isOverdue ? "neg" : "pos"} label={t("loan.repaid_progress")} />
        {s.overpaid > 0 && <p className="mt-2 text-sm text-warn">{t("loan.overpaid", { amount: money(s.overpaid) })}</p>}
      </Card>

      {!loan.closed && (
        <div className="no-print mt-4 flex flex-wrap gap-2">
          {!s.isSettled && (
            <Button icon={borrowed ? <Banknote className="size-4" /> : <Wallet className="size-4" />} onClick={() => openTx({ preset: { type: borrowed ? "debt_repayment" : "collection", loan_id: loan.id } })}>
              {t(borrowed ? "qa.debt_repayment" : "qa.collection")}
            </Button>
          )}
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => openTx({ preset: { type: borrowed ? "borrow" : "lend", loan_id: loan.id } })}>
            {t(borrowed ? "loan.borrow_more" : "loan.lend_more")}
          </Button>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title={t("loan.terms")} />
          <dl className="space-y-2 px-4 pb-4 text-sm sm:px-5">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("loan.interest_terms")}</dt>
              <dd className="text-right">{intLabel}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("loan.interest_accrued")}</dt>
              <dd className="num">{money(s.interestAccrued + loan.opening_interest_due)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("loan.due_date")}</dt>
              <dd>{loan.due_date ? date(loan.due_date) : "—"}</dd>
            </div>
            {s.feesPaid > 0 && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("loan.fees")}</dt>
                <dd className="num">{money(s.feesPaid)}</dd>
              </div>
            )}
            {loan.installment_amount && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("loan.plan")}</dt>
                <dd className="text-right">
                  {t("loan.plan_desc", { n: loan.installment_count ?? 0, amount: money(loan.installment_amount), freq: t(`freq.${loan.installment_frequency}`) })}
                </dd>
              </div>
            )}
            {loan.notes && <p className="whitespace-pre-wrap pt-2 text-muted">{loan.notes}</p>}
          </dl>
        </Card>

        {s.installments.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader title={t("loan.schedule")} />
            <div className="max-h-80 overflow-y-auto px-2 pb-3 sm:px-3">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="px-2 py-1 font-medium">#</th>
                    <th className="px-2 py-1 font-medium">{t("f.date")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("f.amount")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("loan.col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.installments.map((x) => (
                    <tr key={x.index} className="border-t border-line">
                      <td className="num px-2 py-1.5">{i.digits(x.index)}</td>
                      <td className="px-2 py-1.5">{date(x.date)}</td>
                      <td className="num px-2 py-1.5 text-right">{money(x.amount)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Badge tone={x.status === "paid" ? "pos" : x.status === "overdue" ? "neg" : x.status === "partial" || x.status === "due" ? "warn" : "neutral"}>{t(`inst.${x.status}`)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Card className="mt-4 overflow-clip">
        <CardHeader title={t(borrowed ? "loan.repayment_history" : "loan.collection_history")} />
        <TransactionList txs={txs} empty={<Empty title={t("loan.no_tx")} />} />
        {loan.opening_principal > 0 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm text-muted sm:px-5">
            <span>
              {t("loan.opening_principal")} · {date(loan.start_date)}
            </span>
            <span className="num">{money(loan.opening_principal)}</span>
          </div>
        )}
      </Card>

      <div className="no-print mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" icon={loan.closed ? <RotateCcw className="size-4" /> : <CircleCheck className="size-4" />} onClick={toggleClosed}>
          {loan.closed ? t("loan.reopen") : t("loan.close")}
        </Button>
        <Button variant="ghost" className="text-neg" icon={<Trash2 className="size-4" />} onClick={del}>
          {t("loan.delete")}
        </Button>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title={t("loan.edit")}>
        {editing && <LoanForm direction={direction} editing={loan} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />}
      </Modal>
    </>
  );
}
