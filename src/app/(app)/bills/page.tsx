"use client";
import { useMemo, useState } from "react";
import { CalendarClock, Check, Pause, Pencil, Play, Plus, SkipForward, Trash2 } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { billsOverview, monthlyEquivalent, nextOccurrence, type Occurrence } from "@/lib/finance/recurring";
import type { Recurring } from "@/lib/finance/types";
import { Badge, Button, Card, CardHeader, Empty, IconButton, Modal, PageHeader, Stat, cx, useFeedback } from "@/components/ui";
import { RecurringForm } from "@/components/RecurringForm";
import { useTxForm } from "@/components/TxFormProvider";

export default function BillsPage() {
  const { ds, today, update, remove } = useData();
  const { cmap, accountMap } = useDerived();
  const { t, money, date, catName } = useI18n();
  const { openTx } = useTxForm();
  const { confirm, toast } = useFeedback();
  const [form, setForm] = useState<null | { editing?: Recurring }>(null);

  const ov = useMemo(() => billsOverview(ds.recurring, ds.transactions, today, 30), [ds.recurring, ds.transactions, today]);
  const monthlyOut = ds.recurring.filter((r) => r.active && r.kind === "expense").reduce((a, r) => a + monthlyEquivalent(r), 0);
  const monthlyIn = ds.recurring.filter((r) => r.active && r.kind === "income").reduce((a, r) => a + monthlyEquivalent(r), 0);

  const pay = (o: Occurrence) =>
    openTx({
      preset: {
        type: o.recurring.kind,
        amount: o.recurring.amount,
        account_id: o.recurring.account_id ?? undefined,
        category_id: o.recurring.category_id,
        recurring_id: o.recurring.id,
        occurrence_date: o.date,
        description: o.recurring.name,
        date: today,
      },
    });

  const skip = async (o: Occurrence) => {
    const ok = await confirm({ title: t("bill.skip_title"), body: t("bill.skip_body", { name: o.recurring.name, date: date(o.date) }), confirmLabel: t("bill.skip"), cancelLabel: t("common.cancel") });
    if (!ok) return;
    try {
      await update<Recurring>("recurring", o.recurring.id, { skipped_dates: [...o.recurring.skipped_dates, o.date] });
      toast(t("toast.bill_skipped"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const OccList = ({ items, tone }: { items: Occurrence[]; tone: "neg" | "warn" | "neutral" | "pos" }) => (
    <ul className="divide-y divide-line">
      {items.map((o) => {
        const acc = o.recurring.account_id ? accountMap.get(o.recurring.account_id) : null;
        const isIncome = o.recurring.kind === "income";
        return (
          <li key={o.recurring.id + o.date} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{o.recurring.name}</p>
              <p className="text-sm text-muted">
                {date(o.date)}
                {o.daysUntil < 0 ? ` · ${t("when.overdue_days", { n: -o.daysUntil })}` : o.daysUntil === 0 ? ` · ${t("when.today")}` : o.daysUntil <= 7 ? ` · ${t("when.in_days", { n: o.daysUntil })}` : ""}
                {acc ? ` · ${acc.name}` : ""}
              </p>
            </div>
            <span className={cx("num font-semibold", isIncome && "text-brand")}>{money(o.amount)}</span>
            {o.payment ? (
              <Button size="sm" variant="ghost" icon={<Check className="size-4 text-brand" />} onClick={() => openTx({ editing: o.payment! })}>
                {t(isIncome ? "bill.received_on" : "bill.paid_on", { date: date(o.payment.date) })}
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant={tone === "neg" ? "primary" : "secondary"} icon={<Check className="size-4" />} onClick={() => pay(o)}>
                  {t(isIncome ? "bill.mark_received" : "bill.mark_paid")}
                </Button>
                <IconButton label={t("bill.skip")} onClick={() => skip(o)}>
                  <SkipForward className="size-4" />
                </IconButton>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <PageHeader
        title={t("nav.bills")}
        sub={t("bill.sub")}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setForm({})}>
            {t("rec.add")}
          </Button>
        }
      />
      {ds.recurring.length === 0 ? (
        <Card>
          <Empty icon={<CalendarClock />} title={t("bill.empty")} body={t("bill.empty_body")} action={<Button onClick={() => setForm({})} icon={<Plus className="size-4" />}>{t("rec.add")}</Button>} />
        </Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
            <Stat label={t("bill.overdue")} value={money(ov.overdue.filter((o) => o.recurring.kind === "expense").reduce((a, o) => a + o.amount, 0))} tone={ov.overdue.length ? "neg" : "none"} sub={t("bill.count", { n: ov.overdue.length })} />
            <Stat label={t("bill.due_next_30")} value={money([...ov.dueSoon, ...ov.upcoming].filter((o) => o.recurring.kind === "expense").reduce((a, o) => a + o.amount, 0))} />
            <Stat label={t("bill.monthly_commitments")} value={money(monthlyOut)} tone="neg" />
            <Stat label={t("bill.monthly_recurring_income")} value={money(monthlyIn)} tone="pos" />
          </Card>

          <div className="mt-4 space-y-4">
            {ov.overdue.length > 0 && (
              <Card className="overflow-clip border-neg/40">
                <CardHeader title={<span className="text-neg">{t("bill.overdue")}</span>} sub={t("bill.overdue_sub")} />
                <OccList items={ov.overdue} tone="neg" />
              </Card>
            )}
            <Card className="overflow-clip">
              <CardHeader title={t("bill.due_soon")} />
              {ov.dueSoon.length + ov.upcoming.length ? <OccList items={[...ov.dueSoon, ...ov.upcoming]} tone="warn" /> : <Empty title={t("dash.nothing_due")} />}
            </Card>
            {ov.recentPaid.length > 0 && (
              <Card className="overflow-clip">
                <CardHeader title={t("bill.recent_paid")} />
                <OccList items={ov.recentPaid.slice(0, 10)} tone="pos" />
              </Card>
            )}

            <Card className="overflow-clip">
              <CardHeader title={t("bill.schedules")} sub={t("bill.schedules_sub")} />
              <ul className="divide-y divide-line">
                {[...ds.recurring]
                  .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
                  .map((r) => {
                    const next = r.active ? nextOccurrence(r, ds.transactions, today) : null;
                    const cat = r.category_id ? cmap.get(r.category_id) : undefined;
                    return (
                      <li key={r.id} className={cx("flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5", !r.active && "opacity-60")}>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate font-medium">
                            {r.name}
                            {r.kind === "income" && <Badge tone="pos">{t("rec.kind.income")}</Badge>}
                            {!r.active && <Badge>{t("rec.paused")}</Badge>}
                          </p>
                          <p className="text-sm text-muted">
                            {r.interval_count > 1 ? t("rec.every_n", { n: r.interval_count, freq: t(`freq_unit.${r.frequency}`) }) : t(`freq.${r.frequency}`)}
                            {cat ? ` · ${catName(cat)}` : ""}
                            {next ? ` · ${t("rec.next", { date: date(next.date) })}` : r.end_date && r.end_date < today ? ` · ${t("rec.ended")}` : ""}
                          </p>
                        </div>
                        <span className="num font-semibold">{money(r.amount)}</span>
                        <div className="flex">
                          <IconButton label={r.active ? t("rec.pause") : t("rec.resume")} onClick={async () => {
                            try {
                              await update<Recurring>("recurring", r.id, { active: !r.active });
                            } catch (e) {
                              toast(errorText(e, t), "neg");
                            }
                          }}>
                            {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                          </IconButton>
                          <IconButton label={t("common.edit")} onClick={() => setForm({ editing: r })}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton
                            label={t("common.delete")}
                            className="hover:text-neg"
                            onClick={async () => {
                              const ok = await confirm({ title: t("rec.delete_title"), body: t("rec.delete_body"), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true });
                              if (!ok) return;
                              try {
                                await remove("recurring", r.id);
                                toast(t("toast.schedule_deleted"));
                              } catch (e) {
                                toast(errorText(e, t), "neg");
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </Card>
          </div>
        </>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.editing ? t("rec.edit") : t("rec.add")}>
        {form && <RecurringForm editing={form.editing} onCancel={() => setForm(null)} onDone={() => setForm(null)} />}
      </Modal>
    </>
  );
}
