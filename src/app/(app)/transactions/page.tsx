"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { EMPTY_FILTERS, direction, grossAmount, type TxFilters } from "@/lib/finance/filters";
import { transactionsTable } from "@/lib/export";
import type { TxType } from "@/lib/finance/types";
import { TX_TYPES } from "@/lib/finance/types";
import { Button, Card, Empty, PageHeader } from "@/components/ui";
import { FilterBar, TransactionList, useFilteredTransactions } from "@/components/TransactionList";
import { ExportMenu } from "@/components/ExportMenu";
import { useTxForm } from "@/components/TxFormProvider";

function TransactionsInner() {
  const params = useSearchParams();
  const { ds } = useData();
  const i = useI18n();
  const { t, money } = i;
  const { openQuickAdd } = useTxForm();
  const [f, setF] = useState<TxFilters>(EMPTY_FILTERS);

  useEffect(() => {
    const type = params.get("type") as TxType | null;
    setF((prev) => ({
      ...prev,
      types: type && TX_TYPES.includes(type) ? [type] : prev.types,
      accountId: params.get("account") ?? prev.accountId,
      categoryId: params.get("category") ?? prev.categoryId,
      contactId: params.get("person") ?? prev.contactId,
      q: params.get("q") ?? prev.q,
    }));
  }, [params]);

  const txs = useFilteredTransactions(f);
  const totals = useMemo(() => {
    let inflow = 0,
      outflow = 0;
    for (const x of txs) {
      const d = direction(x);
      if (d > 0) inflow += grossAmount(x);
      else if (d < 0) outflow += grossAmount(x);
    }
    return { inflow, outflow };
  }, [txs]);

  return (
    <>
      <PageHeader
        title={t("nav.transactions")}
        sub={t("tx.count", { n: txs.length })}
        actions={
          <>
            <ExportMenu filename="transactions" build={() => [transactionsTable(txs, ds, t, i.catName)]} />
            <Button icon={<Plus className="size-4" />} onClick={openQuickAdd}>
              {t("qa.button")}
            </Button>
          </>
        }
      />
      <FilterBar value={f} onChange={setF} />
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="text-muted">
          {t("tx.money_in")}: <b className="num text-brand">{money(totals.inflow)}</b>
        </span>
        <span className="text-muted">
          {t("tx.money_out")}: <b className="num text-neg">{money(totals.outflow)}</b>
        </span>
      </div>
      <Card className="mt-3 overflow-clip">
        <TransactionList
          txs={txs}
          empty={
            ds.transactions.length ? (
              <Empty title={t("filter.no_match")} body={t("filter.no_match_body")} />
            ) : (
              <Empty
                title={t("tx.empty")}
                body={t("tx.empty_body")}
                action={
                  <Button onClick={openQuickAdd} icon={<Plus className="size-4" />}>
                    {t("qa.button")}
                  </Button>
                }
              />
            )
          }
        />
      </Card>
    </>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense>
      <TransactionsInner />
    </Suspense>
  );
}
