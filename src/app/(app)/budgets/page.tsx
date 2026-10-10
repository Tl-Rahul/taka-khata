"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { budgetRows, budgetsToCopy, type BudgetRow } from "@/lib/finance/budgets";
import { budgetVsActual } from "@/lib/finance/reports";
import { summarize, rankCategories } from "@/lib/finance/engine";
import { addMonths, monthEnd, monthStart } from "@/lib/finance/dates";
import { parseAmount } from "@/lib/finance/money";
import type { Budget } from "@/lib/finance/types";
import { Alert, Badge, Button, Card, CardHeader, Empty, Field, IconButton, Modal, PageHeader, Progress, cx, useFeedback } from "@/components/ui";
import { AmountInput, CategorySelect } from "@/components/fields";
import { BudgetActualChart } from "@/components/charts";

function levelTone(l: BudgetRow["level"]) {
  return l === "over" ? "neg" : l === "ok" ? "pos" : "warn";
}

export default function BudgetsPage() {
  const { ds, today, insert, insertMany, update, remove } = useData();
  const { cmap } = useDerived();
  const i = useI18n();
  const { t, money, pct, catName } = i;
  const { toast, confirm } = useFeedback();
  const [month, setMonth] = useState(monthStart(today));
  const [form, setForm] = useState<null | { editing?: Budget; overall?: boolean }>(null);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => budgetRows(ds, month), [ds, month]);
  const overall = rows.find((r) => !r.budget.category_id);
  const catRows = rows.filter((r) => r.budget.category_id);
  const s = useMemo(() => summarize(ds, month, monthEnd(month)), [ds, month]);
  const budgeted = new Set(catRows.map((r) => r.budget.category_id));
  const coveredByParent = (id: string) => budgeted.has(id) || budgeted.has(cmap.get(id)?.parent_id ?? "");
  const unbudgeted = rankCategories(s.expenseByTopCategory).filter(([id]) => !coveredByParent(id) && ![...budgeted].some((b) => cmap.get(b!)?.parent_id === id));
  const history = useMemo(() => budgetVsActual(ds, monthStart(addMonths(month, -5)), monthEnd(month)).map((r) => ({ ...r, label: i.month(r.month, true) })), [ds, month, i]);
  const prevMonth = monthStart(addMonths(month, -1));
  const copyable = budgetsToCopy(ds.budgets, prevMonth, month);

  const open = (o: { editing?: Budget; overall?: boolean }) => {
    setForm(o);
    setAmount(o.editing ? String(o.editing.amount / 100) : "");
    setCategoryId(o.editing?.category_id ?? "");
    setErr(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const a = parseAmount(amount);
    if (!a) return setErr(t("v.amount_positive"));
    const isOverall = form?.overall || (form?.editing && !form.editing.category_id);
    if (!isOverall && !categoryId) return setErr(t("v.category"));
    if (!form?.editing && !isOverall && budgeted.has(categoryId)) return setErr(t("budget.exists"));
    setSaving(true);
    try {
      if (form?.editing) await update<Budget>("budgets", form.editing.id, { amount: a });
      else await insert<Budget>("budgets", { month, category_id: isOverall ? null : categoryId, amount: a });
      toast(t("toast.budget_saved"));
      setForm(null);
    } catch (e2) {
      setErr(errorText(e2, t));
    } finally {
      setSaving(false);
    }
  }

  const del = async (b: Budget) => {
    if (!(await confirm({ title: t("budget.delete_title"), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true }))) return;
    try {
      await remove("budgets", b.id);
      toast(t("toast.budget_deleted"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const copy = async () => {
    try {
      await insertMany<Budget>("budgets", copyable.map((c) => ({ ...c, month })));
      toast(t("budget.copied", { n: copyable.length }));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const Row = ({ r }: { r: BudgetRow }) => (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{r.category ? catName(r.category) : t("budget.overall")}</p>
          <p className="num text-sm text-muted">
            {money(r.spent)} / {money(r.budget.amount)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className={cx("num font-semibold", r.remaining < 0 && "text-neg")}>{r.remaining >= 0 ? t("budget.left", { amount: money(r.remaining) }) : t("budget.over_by", { amount: money(-r.remaining) })}</p>
            {r.level !== "ok" && <Badge tone={levelTone(r.level)}>{t(`budget.level.${r.level}`)}</Badge>}
          </div>
          <IconButton label={t("common.edit")} onClick={() => open({ editing: r.budget })}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton label={t("common.delete")} onClick={() => del(r.budget)} className="hover:text-neg">
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Progress ratio={r.ratio} tone={levelTone(r.level)} className="flex-1" label={pct(r.ratio)} />
        <span className="num w-12 text-right text-sm text-muted">{pct(r.ratio)}</span>
      </div>
    </li>
  );

  return (
    <>
      <PageHeader
        title={t("nav.budgets")}
        sub={t("budget.sub")}
        actions={
          <div className="flex items-center">
            <IconButton label={t("period.prev")} onClick={() => setMonth(monthStart(addMonths(month, -1)))}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <span className="min-w-[8.5rem] text-center font-medium">{i.month(month.slice(0, 7))}</span>
            <IconButton label={t("period.next")} onClick={() => setMonth(monthStart(addMonths(month, 1)))}>
              <ChevronRight className="size-5" />
            </IconButton>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader title={t("budget.overall")} sub={t("budget.overall_sub")} action={!overall && <Button size="sm" onClick={() => open({ overall: true })} icon={<Plus className="size-4" />}>{t("budget.set")}</Button>} />
            {overall ? (
              <ul>
                <Row r={overall} />
              </ul>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted sm:px-5">{t("budget.no_overall", { amount: money(s.expense) })}</p>
            )}
          </Card>

          <Card>
            <CardHeader
              title={t("budget.by_category")}
              action={
                <div className="flex gap-2">
                  {copyable.length > 0 && (
                    <Button size="sm" variant="outline" icon={<Copy className="size-4" />} onClick={copy}>
                      {t("budget.copy_prev", { n: copyable.length })}
                    </Button>
                  )}
                  <Button size="sm" icon={<Plus className="size-4" />} onClick={() => open({})}>
                    {t("budget.add")}
                  </Button>
                </div>
              }
            />
            {catRows.length ? (
              <ul className="divide-y divide-line">
                {catRows.map((r) => (
                  <Row key={r.budget.id} r={r} />
                ))}
              </ul>
            ) : (
              <Empty title={t("budget.none")} body={t("budget.none_body")} />
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t("chart.budget_vs_actual")} sub={t("budget.compare_sub")} />
            <div className="px-2 pb-3 sm:px-4">
              <BudgetActualChart data={history} />
            </div>
          </Card>
          {unbudgeted.length > 0 && (
            <Card>
              <CardHeader title={t("budget.unbudgeted")} sub={t("budget.unbudgeted_sub")} />
              <ul className="space-y-1.5 px-4 pb-4 text-sm sm:px-5">
                {unbudgeted.slice(0, 8).map(([id, v]) => (
                  <li key={id} className="flex justify-between gap-2">
                    <span>{cmap.get(id) ? catName(cmap.get(id)) : t(`syscat.${id.replace("sys:", "")}`)}</span>
                    <span className="num font-medium">{money(v)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.editing ? t("budget.edit") : form?.overall ? t("budget.set_overall") : t("budget.add")} size="sm">
        <form onSubmit={save} className="space-y-4" noValidate>
          {!form?.overall && !form?.editing && (
            <Field label={t("f.category")} htmlFor="b-cat">
              <CategorySelect id="b-cat" kind="expense" value={categoryId} onChange={setCategoryId} />
            </Field>
          )}
          <Field label={t("budget.amount_for", { month: i.month(month.slice(0, 7)) })} htmlFor="b-amt">
            <AmountInput id="b-amt" value={amount} onChange={setAmount} big data-autofocus />
          </Field>
          {err && <Alert tone="neg">{err}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
