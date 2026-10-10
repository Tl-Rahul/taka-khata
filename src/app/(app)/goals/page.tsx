"use client";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Minus, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { goalProgress, allocationSummary, type GoalProgress } from "@/lib/finance/goals";
import { parseAmount } from "@/lib/finance/money";
import type { Goal, GoalEntry } from "@/lib/finance/types";
import { Alert, Badge, Button, Card, Empty, Field, IconButton, Input, Modal, PageHeader, Progress, Stat, Textarea, cx, useFeedback } from "@/components/ui";
import { AccountSelect, AmountInput } from "@/components/fields";

const COLORS = ["#0b6e4f", "#2b67a6", "#c2417a", "#e07a1f", "#7c5cc4", "#1f9d8b", "#b8862b"];

export default function GoalsPage() {
  const { ds, today, insert, update, remove } = useData();
  const { nw } = useDerived();
  const i = useI18n();
  const { t, money, pct, date } = i;
  const { toast, confirm } = useFeedback();
  const [goalForm, setGoalForm] = useState<null | { editing?: Goal }>(null);
  const [entryForm, setEntryForm] = useState<null | { goal: Goal; sign: 1 | -1 }>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const progress = useMemo(() => ds.goals.map((g) => goalProgress(g, ds.goal_entries, today)), [ds.goals, ds.goal_entries, today]);
  const active = progress.filter((p) => !p.goal.archived);
  const archived = progress.filter((p) => p.goal.archived);
  const alloc = allocationSummary(active, nw.availableBalance);

  // goal form state
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [notes, setNotes] = useState("");
  // entry form state
  const [eAmount, setEAmount] = useState("");
  const [eDate, setEDate] = useState(today);
  const [eNotes, setENotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openGoal = (g?: Goal) => {
    setGoalForm({ editing: g });
    setName(g?.name ?? "");
    setTarget(g ? String(g.target_amount / 100) : "");
    setTargetDate(g?.target_date ?? "");
    setAccountId(g?.account_id ?? "");
    setColor(g?.color ?? COLORS[ds.goals.length % COLORS.length]);
    setNotes(g?.notes ?? "");
    setErr(null);
  };
  const openEntry = (goal: Goal, sign: 1 | -1) => {
    setEntryForm({ goal, sign });
    setEAmount("");
    setEDate(today);
    setENotes("");
    setErr(null);
  };

  async function saveGoal(e: React.FormEvent) {
    e.preventDefault();
    const tg = parseAmount(target);
    if (!name.trim()) return setErr(t("v.name"));
    if (!tg) return setErr(t("v.amount_positive"));
    setSaving(true);
    try {
      const row: Partial<Goal> = { name: name.trim(), target_amount: tg, target_date: targetDate || null, account_id: accountId || null, color, notes: notes.trim() || null };
      if (goalForm?.editing) await update<Goal>("goals", goalForm.editing.id, row);
      else await insert<Goal>("goals", { ...row, archived: false });
      toast(t("toast.goal_saved"));
      setGoalForm(null);
    } catch (e2) {
      setErr(errorText(e2, t));
    } finally {
      setSaving(false);
    }
  }

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!entryForm) return;
    const a = parseAmount(eAmount);
    if (!a) return setErr(t("v.amount_positive"));
    const p = progress.find((x) => x.goal.id === entryForm.goal.id)!;
    if (entryForm.sign < 0 && a > p.saved) return setErr(t("goal.withdraw_too_much", { amount: money(p.saved) }));
    setSaving(true);
    try {
      await insert<GoalEntry>("goal_entries", { goal_id: entryForm.goal.id, date: eDate, amount: entryForm.sign * a, notes: eNotes.trim() || null });
      toast(t(entryForm.sign > 0 ? "toast.goal_contributed" : "toast.goal_withdrawn"));
      setEntryForm(null);
    } catch (e2) {
      setErr(errorText(e2, t));
    } finally {
      setSaving(false);
    }
  }

  const delGoal = async (g: Goal) => {
    if (!(await confirm({ title: t("goal.delete_title"), body: t("goal.delete_body"), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true }))) return;
    try {
      await remove("goals", g.id);
      toast(t("toast.goal_deleted"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const GoalCard = ({ p }: { p: GoalProgress }) => {
    const g = p.goal;
    const acc = g.account_id ? ds.accounts.find((a) => a.id === g.account_id) : null;
    return (
      <Card className="overflow-clip">
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[17px] font-semibold">
                <span className="size-3 rounded-full" style={{ background: g.color ?? COLORS[0] }} />
                {g.name}
                {p.done && <Badge tone="pos">{t("goal.reached")}</Badge>}
              </p>
              <p className="text-sm text-muted">
                {[g.target_date ? t("goal.by_date", { date: date(g.target_date) }) : null, acc ? t("goal.kept_in", { account: acc.name }) : null].filter(Boolean).join(" · ") || t("goal.no_date")}
              </p>
            </div>
            <div className="flex shrink-0">
              <IconButton label={t("common.edit")} onClick={() => openGoal(g)}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton
                label={g.archived ? t("acc.unarchive") : t("acc.archive")}
                onClick={async () => {
                  try {
                    await update<Goal>("goals", g.id, { archived: !g.archived });
                  } catch (e) {
                    toast(errorText(e, t), "neg");
                  }
                }}
              >
                {g.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              </IconButton>
              <IconButton label={t("common.delete")} onClick={() => delGoal(g)} className="hover:text-neg">
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="mt-3 flex items-end justify-between gap-2">
            <p className="num text-2xl font-semibold">{money(p.saved)}</p>
            <p className="num text-sm text-muted">
              {t("goal.of_target", { amount: money(g.target_amount) })} · {pct(p.ratio)}
            </p>
          </div>
          <Progress className="mt-2" ratio={p.ratio} label={pct(p.ratio)} />
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-muted">
            <span>{p.remaining > 0 ? t("goal.remaining", { amount: money(p.remaining) }) : t("goal.reached")}</span>
            {p.monthlyNeeded !== null && (
              <span className={cx(p.daysLeft !== null && p.daysLeft < 0 && "text-neg")}>
                {p.daysLeft !== null && p.daysLeft < 0 ? t("goal.past_date") : t("goal.per_month", { amount: money(p.monthlyNeeded) })}
              </span>
            )}
          </div>
          {!g.archived && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => openEntry(g, 1)}>
                {t("goal.add_money")}
              </Button>
              <Button size="sm" variant="secondary" icon={<Minus className="size-4" />} onClick={() => openEntry(g, -1)} disabled={p.saved <= 0}>
                {t("goal.withdraw")}
              </Button>
              {p.entries.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setExpanded((x) => (x === g.id ? null : g.id))}>
                  {expanded === g.id ? t("goal.hide_history") : t("goal.history", { n: p.entries.length })}
                </Button>
              )}
            </div>
          )}
        </div>
        {expanded === g.id && (
          <ul className="divide-y divide-line border-t border-line">
            {p.entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm sm:px-5">
                <span className="w-28 text-muted">{date(e.date)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{e.notes}</span>
                <span className={cx("num font-medium", e.amount < 0 ? "text-neg" : "text-brand")}>{money(e.amount, { signed: true })}</span>
                <IconButton
                  label={t("common.delete")}
                  className="hover:text-neg"
                  onClick={async () => {
                    try {
                      await remove("goal_entries", e.id);
                    } catch (er) {
                      toast(errorText(er, t), "neg");
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  };

  return (
    <>
      <PageHeader
        title={t("nav.goals")}
        sub={t("goal.sub")}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => openGoal()}>
            {t("goal.new")}
          </Button>
        }
      />
      {active.length > 0 && (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 sm:p-5">
            <Stat label={t("goal.total_saved")} value={money(alloc.allocated)} />
            <Stat label={t("goal.total_target")} value={money(active.reduce((a, p) => a + p.goal.target_amount, 0))} />
            <Stat label={t("goal.unallocated")} value={money(alloc.unallocated)} tone={alloc.overAllocated ? "neg" : "none"} sub={t("goal.unallocated_hint")} />
          </Card>
          {alloc.overAllocated && (
            <Alert tone="warn" className="mt-3">
              {t("goal.over_allocated")}
            </Alert>
          )}
          <p className="mt-3 text-sm text-muted">{t("goal.no_double_count")}</p>
        </>
      )}
      {active.length === 0 ? (
        <Card className="mt-2">
          <Empty icon={<Target />} title={t("goal.empty")} body={t("goal.empty_body")} action={<Button onClick={() => openGoal()} icon={<Plus className="size-4" />}>{t("goal.new")}</Button>} />
        </Card>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {active.map((p) => (
            <GoalCard key={p.goal.id} p={p} />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <div className="mt-6">
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "▾" : "▸"} {t("goal.archived", { n: archived.length })}
          </button>
          {showArchived && (
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              {archived.map((p) => (
                <GoalCard key={p.goal.id} p={p} />
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={!!goalForm} onClose={() => setGoalForm(null)} title={goalForm?.editing ? t("goal.edit") : t("goal.new")}>
        <form onSubmit={saveGoal} className="space-y-4" noValidate>
          <Field label={t("goal.name")} htmlFor="g-name">
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("goal.name_ph")} data-autofocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("goal.target")} htmlFor="g-target">
              <AmountInput id="g-target" value={target} onChange={setTarget} />
            </Field>
            <Field label={t("goal.target_date")} htmlFor="g-date">
              <Input id="g-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
          </div>
          <Field label={t("goal.account")} hint={t("goal.account_hint")} htmlFor="g-acc">
            <AccountSelect id="g-acc" value={accountId} onChange={setAccountId} placeholder={t("goal.any_account")} allowEmpty />
          </Field>
          <Field label={t("acc.color")}>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={cx("size-7 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-ink")} style={{ background: c }} />
              ))}
            </div>
          </Field>
          <Field label={t("f.notes")} htmlFor="g-notes">
            <Textarea id="g-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
          {err && <Alert tone="neg">{err}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setGoalForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!entryForm} onClose={() => setEntryForm(null)} title={entryForm ? `${t(entryForm.sign > 0 ? "goal.add_money" : "goal.withdraw")} — ${entryForm.goal.name}` : ""} size="sm">
        <form onSubmit={saveEntry} className="space-y-4" noValidate>
          <Field label={t("f.amount")} htmlFor="ge-amt">
            <AmountInput id="ge-amt" value={eAmount} onChange={setEAmount} big data-autofocus />
          </Field>
          <Field label={t("f.date")} htmlFor="ge-date">
            <Input id="ge-date" type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} />
          </Field>
          <Field label={t("f.notes")} htmlFor="ge-notes">
            <Input id="ge-notes" value={eNotes} onChange={(e) => setENotes(e.target.value)} maxLength={500} />
          </Field>
          <p className="text-xs text-muted">{t("goal.entry_hint")}</p>
          {err && <Alert tone="neg">{err}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEntryForm(null)}>
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
