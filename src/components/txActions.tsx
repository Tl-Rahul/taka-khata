"use client";
import { useData } from "@/lib/data/DataProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { deleteReceipt } from "@/lib/data/receipts";
import { grossAmount } from "@/lib/finance/filters";
import type { Transaction } from "@/lib/finance/types";
import { useFeedback } from "./ui";

export function useDeleteTx() {
  const { remove, ds } = useData();
  const { t, money } = useI18n();
  const { confirm, toast } = useFeedback();
  return async (tx: Transaction) => {
    const refunds = ds.transactions.filter((x) => x.refund_of === tx.id).length;
    const ok = await confirm({
      title: t("tx.delete_title"),
      body: (
        <>
          <p>{t("tx.delete_body", { amount: money(grossAmount(tx)) })}</p>
          {refunds > 0 && <p className="mt-2">{t("tx.delete_has_refunds", { n: refunds })}</p>}
          {tx.recurring_id && <p className="mt-2">{t("tx.delete_recurring")}</p>}
        </>
      ),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!ok) return false;
    try {
      await remove("transactions", tx.id);
      if (tx.attachment_path) deleteReceipt(tx.attachment_path).catch(() => {});
      toast(t("toast.tx_deleted"));
      return true;
    } catch (e) {
      toast(errorText(e, t), "neg");
      return false;
    }
  };
}

