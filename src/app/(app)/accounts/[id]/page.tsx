"use client";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, ArrowLeftRight, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { runningBalances, summarize, compareTxDesc } from "@/lib/finance/engine";
import { deltaFor } from "@/lib/finance/filters";
import { monthPeriod } from "@/lib/finance/dates";
import type { Account } from "@/lib/finance/types";
import { transactionsTable } from "@/lib/export";
import { accountColor } from "@/lib/accountMeta";
import { Badge, Button, Card, Dot, Empty, Modal, PageHeader, Stat, cx, useFeedback } from "@/components/ui";
import { AccountForm } from "@/components/AccountForm";
import { TransactionList } from "@/components/TransactionList";
import { useTxForm } from "@/components/TxFormProvider";
import { ExportMenu } from "@/components/ExportMenu";

export default function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ds, today, update, remove } = useData();
  const { balances } = useDerived();
  const i = useI18n();
  const { t, money, date } = i;
  const { openTx } = useTxForm();
  const { confirm, toast } = useFeedback();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const acc = ds.accounts.find((a) => a.id === id);

  const txs = useMemo(() => ds.transactions.filter((x) => x.account_id === id || x.to_account_id === id).sort(compareTxDesc), [ds.transactions, id]);
  const running = useMemo(() => (acc ? runningBalances(acc, ds.transactions) : new Map()), [acc, ds.transactions]);
  const month = monthPeriod(today);
  const flows = useMemo(() => {
    let inflow = 0,
      outflow = 0;
    for (const x of txs) {
      if (x.date < month.from || x.date > month.to) continue;
      const d = deltaFor(x, id);
      if (d > 0) inflow += d;
      else outflow += -d;
    }
    return { inflow, outflow };
  }, [txs, id, month.from, month.to]);
  void summarize;

  if (!acc) {
    return <Empty title={t("acc.not_found")} action={<Link href="/accounts" className="text-brand hover:underline">{t("nav.accounts")}</Link>} />;
  }
  const bal = balances.get(acc.id) ?? 0;

  const toggleArchive = async () => {
    if (!acc.archived && bal !== 0) {
      const ok = await confirm({ title: t("acc.archive_title"), body: t("acc.archive_nonzero", { amount: money(bal) }), confirmLabel: t("acc.archive"), cancelLabel: t("common.cancel") });
      if (!ok) return;
    }
    try {
      await update<Account>("accounts", acc.id, { archived: !acc.archived });
      toast(t(acc.archived ? "toast.account_restored" : "toast.account_archived"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const del = async () => {
    if (txs.length || ds.recurring.some((r) => r.account_id === acc.id)) {
      toast(t("acc.delete_in_use"), "neg");
      return;
    }
    const ok = await confirm({ title: t("acc.delete_title"), body: t("acc.delete_body", { name: acc.name }), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true });
    if (!ok) return;
    try {
      await remove("accounts", acc.id);
      toast(t("toast.account_deleted"));
      router.push("/accounts");
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  return (
    <>
      <Link href="/accounts" className="no-print mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {t("nav.accounts")}
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <Dot color={accountColor(acc)} className="size-3.5" />
            {acc.name}
            {acc.archived && <Badge>{t("acc.archived_badge")}</Badge>}
          </span>
        }
        sub={[t(`acctype.${acc.type}`), acc.institution, acc.last4 ? `••${acc.last4}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <ExportMenu filename={`account-${acc.name}`} build={() => [transactionsTable(txs, ds, t, i.catName)]} />
            <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
          </>
        }
      />

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <Stat label={t("acc.balance")} value={money(bal)} tone={bal < 0 ? "neg" : "none"} />
        <Stat label={t("acc.in_this_month")} value={money(flows.inflow)} tone="pos" />
        <Stat label={t("acc.out_this_month")} value={money(flows.outflow)} tone="neg" />
        <Stat label={t("acc.opening")} value={money(acc.opening_balance)} sub={date(acc.opening_date)} />
      </Card>

      <div className="no-print mt-4 flex flex-wrap gap-2">
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => openTx({ preset: { type: "expense", account_id: acc.id } })}>
          {t("qa.expense")}
        </Button>
        <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => openTx({ preset: { type: "income", account_id: acc.id } })}>
          {t("qa.income")}
        </Button>
        <Button size="sm" variant="secondary" icon={<ArrowLeftRight className="size-4" />} onClick={() => openTx({ preset: { type: "transfer", account_id: acc.id } })}>
          {t("qa.transfer")}
        </Button>
        <Button size="sm" variant="secondary" icon={<Scale className="size-4" />} onClick={() => openTx({ preset: { type: "adjustment", account_id: acc.id } })}>
          {acc.is_liquid ? t("acc.reconcile") : t("acc.update_value")}
        </Button>
        <Button size="sm" variant="ghost" icon={acc.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={toggleArchive}>
          {acc.archived ? t("acc.unarchive") : t("acc.archive")}
        </Button>
        <Button size="sm" variant="ghost" className="text-neg" icon={<Trash2 className="size-4" />} onClick={del}>
          {t("common.delete")}
        </Button>
      </div>

      {(acc.maturity_date || acc.interest_rate != null || acc.credit_limit) && (
        <p className="mt-3 text-sm text-muted">
          {acc.maturity_date && <>{t("acc.maturity")}: {date(acc.maturity_date)} </>}
          {acc.interest_rate != null && <> · {t("acc.rate")}: {i.num(acc.interest_rate, 3)}% </>}
          {acc.credit_limit ? <> · {t("acc.credit_limit")}: {money(acc.credit_limit)}</> : null}
        </p>
      )}

      <Card className="mt-4 overflow-clip">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 sm:px-5">
          <h2 className="text-[17px] font-semibold">{t("acc.history")}</h2>
          <span className="text-sm text-muted">{t("acc.running_balance")}</span>
        </div>
        <TransactionList txs={txs} accountId={acc.id} running={running} empty={<Empty title={t("acc.no_tx")} />} />
        <div className={cx("flex items-center justify-between border-t border-line px-4 py-2.5 text-sm text-muted sm:px-5")}>
          <span>
            {t("acc.opening")} · {date(acc.opening_date)}
          </span>
          <span className="num">{money(acc.opening_balance)}</span>
        </div>
      </Card>

      <Modal open={editing} onClose={() => setEditing(false)} title={t("acc.edit")}>
        {editing && <AccountForm editing={acc} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />}
      </Modal>
    </>
  );
}
