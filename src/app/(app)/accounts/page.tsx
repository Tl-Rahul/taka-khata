"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArchiveRestore, ArrowLeftRight, Plus } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { ACCOUNT_TYPES, type Account } from "@/lib/finance/types";
import { accountColor } from "@/lib/accountMeta";
import { Badge, Button, Card, Dot, Empty, Modal, PageHeader, Stat, cx, useFeedback } from "@/components/ui";
import { AccountForm } from "@/components/AccountForm";
import { useTxForm } from "@/components/TxFormProvider";

function AccountsInner() {
  const { ds, update } = useData();
  const { balances, nw } = useDerived();
  const { t, money } = useI18n();
  const { toast } = useFeedback();
  const { openTx } = useTxForm();
  const params = useSearchParams();
  const router = useRouter();
  const [form, setForm] = useState<{ editing?: Account } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (params.get("new") === "1") {
      setForm({});
      router.replace("/accounts");
    }
  }, [params, router]);

  const groups = useMemo(() => {
    const active = ds.accounts.filter((a) => !a.archived);
    return ACCOUNT_TYPES.map((type) => ({ type, items: active.filter((a) => a.type === type).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
  }, [ds.accounts]);
  const archived = ds.accounts.filter((a) => a.archived);

  return (
    <>
      <PageHeader
        title={t("nav.accounts")}
        sub={t("acc.sub")}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeftRight className="size-4" />} onClick={() => openTx({ preset: { type: "transfer" } })} disabled={ds.accounts.filter((a) => !a.archived).length < 2}>
              {t("qa.transfer")}
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setForm({})}>
              {t("acc.add")}
            </Button>
          </>
        }
      />

      {ds.accounts.length > 0 && (
        <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
          <Stat label={t("dash.available")} value={money(nw.availableBalance)} tone={nw.availableBalance < 0 ? "neg" : "none"} />
          <Stat label={t("nw.liquid")} value={money(nw.liquidAssets)} />
          <Stat label={t("acc.non_liquid_accounts")} value={money(ds.accounts.reduce((s, a) => s + (!a.is_liquid ? Math.max(0, balances.get(a.id) ?? 0) : 0), 0))} />
          <Stat label={t("acc.card_debt")} value={money(nw.accountLiabilities)} tone={nw.accountLiabilities ? "neg" : "none"} />
        </Card>
      )}

      {groups.length === 0 ? (
        <Card>
          <Empty title={t("acc.empty")} body={t("acc.empty_body")} action={<Button onClick={() => setForm({})} icon={<Plus className="size-4" />}>{t("acc.add_first")}</Button>} />
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const sum = g.items.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
            return (
              <Card key={g.type} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5 sm:px-5">
                  <h2 className="font-semibold">{t(`acctype.${g.type}`)}</h2>
                  <span className={cx("num text-sm font-semibold", sum < 0 && "text-neg")}>{money(sum)}</span>
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((a) => {
                    const b = balances.get(a.id) ?? 0;
                    return (
                      <li key={a.id}>
                        <Link href={`/accounts/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 sm:px-5">
                          <Dot color={accountColor(a)} className="size-3" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{a.name}</p>
                            <p className="truncate text-sm text-muted">
                              {[a.institution, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(" ") || t(`acctype.${a.type}`)}
                              {!a.is_liquid && <Badge className="ml-2">{t("acc.non_liquid")}</Badge>}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={cx("num font-semibold", b < 0 && "text-neg")}>{money(b)}</p>
                            {a.type === "credit_card" && a.credit_limit ? <p className="num text-xs text-muted">{t("acc.available_credit", { amount: money(a.credit_limit + b) })}</p> : null}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-6">
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "▾" : "▸"} {t("acc.archived", { n: archived.length })}
          </button>
          {showArchived && (
            <Card className="mt-2">
              <ul className="divide-y divide-line">
                {archived.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <Link href={`/accounts/${a.id}`} className="min-w-0 flex-1 truncate text-muted hover:text-ink">
                      {a.name}
                    </Link>
                    <span className="num text-sm text-muted">{money(balances.get(a.id) ?? 0)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<ArchiveRestore className="size-4" />}
                      onClick={async () => {
                        try {
                          await update<Account>("accounts", a.id, { archived: false });
                          toast(t("toast.account_restored"));
                        } catch (e) {
                          toast(errorText(e, t), "neg");
                        }
                      }}
                    >
                      {t("acc.unarchive")}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.editing ? t("acc.edit") : t("acc.add")}>
        {form && <AccountForm editing={form.editing} onCancel={() => setForm(null)} onDone={() => setForm(null)} />}
      </Modal>
    </>
  );
}

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsInner />
    </Suspense>
  );
}
