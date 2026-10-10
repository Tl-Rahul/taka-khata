"use client";
import { useState } from "react";
import { useData } from "@/lib/data/DataProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { parseAmount } from "@/lib/finance/money";
import { FREQUENCIES, type CategoryKind, type Frequency, type Recurring } from "@/lib/finance/types";
import { AccountSelect, AmountInput, CategorySelect } from "./fields";
import { Alert, Button, Checkbox, Field, Input, Segmented, Select, Textarea, useFeedback } from "./ui";

export function RecurringForm({ editing, onDone, onCancel }: { editing?: Recurring; onDone: () => void; onCancel: () => void }) {
  const { insert, update, today, ds } = useData();
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [kind, setKind] = useState<CategoryKind>(editing?.kind ?? "expense");
  const [name, setName] = useState(editing?.name ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amount / 100) : "");
  const [accountId, setAccountId] = useState(editing?.account_id ?? "");
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? "");
  const [frequency, setFrequency] = useState<Frequency>(editing?.frequency ?? "monthly");
  const [interval, setInterval] = useState(String(editing?.interval_count ?? 1));
  const [start, setStart] = useState(editing?.start_date ?? today);
  const [end, setEnd] = useState(editing?.end_date ?? "");
  const [isBill, setIsBill] = useState(editing?.is_bill ?? true);
  const [remind, setRemind] = useState(String(editing?.remind_days_before ?? ds.profile?.reminders.days_before ?? 3));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const paidCount = editing ? ds.transactions.filter((x) => x.recurring_id === editing.id).length : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "v.name";
    const a = parseAmount(amount);
    if (!a) errs.amount = "v.amount_positive";
    const iv = Number(interval);
    if (!Number.isInteger(iv) || iv < 1 || iv > 52) errs.interval = "v.count";
    if (!start) errs.start = "v.date";
    if (end && end < start) errs.end = "v.end_before_start";
    const rd = Number(remind);
    if (!Number.isInteger(rd) || rd < 0 || rd > 60) errs.remind = "v.count";
    if (!categoryId) errs.category = "v.category";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setFormError(null);
    const row: Partial<Recurring> = {
      kind,
      name: name.trim(),
      amount: a!,
      account_id: accountId || null,
      category_id: categoryId || null,
      frequency,
      interval_count: iv,
      start_date: start,
      end_date: end || null,
      is_bill: kind === "expense" ? isBill : false,
      remind_days_before: rd,
      notes: notes.trim() || null,
    };
    try {
      if (editing) await update<Recurring>("recurring", editing.id, row);
      else await insert<Recurring>("recurring", { ...row, active: true, skipped_dates: [] });
      toast(t("toast.schedule_saved"));
      onDone();
    } catch (err) {
      setFormError(errorText(err, t));
    } finally {
      setSaving(false);
    }
  }
  const E = (k: string) => (errors[k] ? t(errors[k]) : null);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!editing || paidCount === 0 ? (
        <Segmented
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategoryId("");
          }}
          options={[
            { value: "expense", label: t("rec.kind.expense") },
            { value: "income", label: t("rec.kind.income") },
          ]}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("rec.name")} error={E("name")} htmlFor="r-name">
          <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t(kind === "expense" ? "rec.name_ph" : "rec.name_ph_income")} data-autofocus />
        </Field>
        <Field label={t("f.amount")} error={E("amount")} htmlFor="r-amt">
          <AmountInput id="r-amt" value={amount} onChange={setAmount} invalid={!!errors.amount} />
        </Field>
        <Field label={t("f.category")} error={E("category")} htmlFor="r-cat">
          <CategorySelect id="r-cat" kind={kind} value={categoryId} onChange={setCategoryId} invalid={!!errors.category} />
        </Field>
        <Field label={t(kind === "expense" ? "f.paid_from" : "f.to_account_received")} htmlFor="r-acc">
          <AccountSelect id="r-acc" value={accountId} onChange={setAccountId} showBalance={false} allowEmpty placeholder={t("rec.choose_when_paying")} />
        </Field>
        <Field label={t("rec.frequency")} htmlFor="r-freq">
          <div className="flex gap-2">
            <Select id="r-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`freq.${f}`)}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label={t("rec.every")} error={E("interval")} hint={t("rec.every_hint")} htmlFor="r-int">
          <Input id="r-int" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label={t("rec.first_due")} error={E("start")} htmlFor="r-start">
          <Input id="r-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t("rec.end")} error={E("end")} htmlFor="r-end">
          <Input id="r-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label={t("rec.remind_days")} error={E("remind")} htmlFor="r-rem">
          <Input id="r-rem" inputMode="numeric" value={remind} onChange={(e) => setRemind(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      {kind === "expense" && <Checkbox label={t("rec.is_bill")} checked={isBill} onChange={setIsBill} />}
      <Field label={t("f.notes")} htmlFor="r-notes">
        <Textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      {editing && paidCount > 0 && <Alert tone="info">{t("rec.edit_note", { n: paidCount })}</Alert>}
      {formError && <Alert tone="neg">{formError}</Alert>}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {editing ? t("common.save_changes") : t("rec.add")}
        </Button>
      </div>
    </form>
  );
}
