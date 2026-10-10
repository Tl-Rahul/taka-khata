"use client";
import { useState } from "react";
import { useData } from "@/lib/data/DataProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { parseAmount } from "@/lib/finance/money";
import { ACCOUNT_TYPES, DEFAULT_LIQUID, type Account, type AccountType } from "@/lib/finance/types";
import { ACCOUNT_COLORS } from "@/lib/accountMeta";
import { AmountInput } from "./fields";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, useFeedback } from "./ui";

export function AccountForm({ editing, onDone, onCancel }: { editing?: Account; onDone: (a: Account) => void; onCancel: () => void }) {
  const { insert, update, today } = useData();
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [name, setName] = useState(editing?.name ?? "");
  const [type, setType] = useState<AccountType>(editing?.type ?? "cash");
  const [institution, setInstitution] = useState(editing?.institution ?? "");
  const [last4, setLast4] = useState(editing?.last4 ?? "");
  const isCard = type === "credit_card";
  const [opening, setOpening] = useState(editing ? String(Math.abs(editing.opening_balance) / 100) : "");
  const [openingNeg, setOpeningNeg] = useState(editing ? editing.opening_balance < 0 && editing.type !== "credit_card" : false);
  const [openingDate, setOpeningDate] = useState(editing?.opening_date ?? today);
  const [liquid, setLiquid] = useState(editing?.is_liquid ?? true);
  const [limit, setLimit] = useState(editing?.credit_limit ? String(editing.credit_limit / 100) : "");
  const [maturity, setMaturity] = useState(editing?.maturity_date ?? "");
  const [rate, setRate] = useState(editing?.interest_rate != null ? String(editing.interest_rate) : "");
  const [color, setColor] = useState(editing?.color ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const changeType = (v: AccountType) => {
    setType(v);
    if (!editing) setLiquid(DEFAULT_LIQUID[v]);
    if (!name.trim() || ACCOUNT_TYPES.some((x) => t(`acctype.${x}`) === name)) setName(t(`acctype.${v}`));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "v.name";
    const ob = opening.trim() ? parseAmount(opening) : 0;
    if (ob === null) errs.opening = "v.amount";
    if (last4 && !/^\d{4}$/.test(last4)) errs.last4 = "v.last4";
    const lim = limit.trim() ? parseAmount(limit) : null;
    if (limit.trim() && lim === null) errs.limit = "v.amount";
    const r = rate.trim() ? Number(rate.replace(",", ".")) : null;
    if (r !== null && (!Number.isFinite(r) || r < 0 || r > 1000)) errs.rate = "v.rate";
    if (!openingDate) errs.openingDate = "v.date";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // credit card: the user enters what they owe; we store it as a negative balance
    const signed = isCard ? -(ob ?? 0) : openingNeg ? -(ob ?? 0) : ob ?? 0;
    const row: Partial<Account> = {
      name: name.trim(),
      type,
      institution: institution.trim() || null,
      last4: last4 || null,
      opening_balance: signed,
      opening_date: openingDate,
      is_liquid: liquid,
      credit_limit: isCard ? lim : null,
      maturity_date: type === "fixed_deposit" ? maturity || null : null,
      interest_rate: ["fixed_deposit", "savings"].includes(type) ? r : null,
      color: color || null,
      notes: notes.trim() || null,
    };
    setSaving(true);
    setFormError(null);
    try {
      const saved = editing ? await update<Account>("accounts", editing.id, row) : await insert<Account>("accounts", { ...row, sort_order: Date.now() % 100000 });
      toast(t(editing ? "toast.account_updated" : "toast.account_added"));
      onDone(saved);
    } catch (err) {
      setFormError(errorText(err, t));
    } finally {
      setSaving(false);
    }
  }
  const E = (k: string) => (errors[k] ? t(errors[k]) : null);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("acc.type")} htmlFor="acc-type">
          <Select id="acc-type" value={type} onChange={(e) => changeType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`acctype.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("acc.name")} error={E("name")} htmlFor="acc-name">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} invalid={!!errors.name} placeholder={t("acc.name_ph")} data-autofocus />
        </Field>
        <Field label={isCard ? t("acc.opening_owed") : t("acc.opening")} error={E("opening")} hint={t("acc.opening_hint")} htmlFor="acc-ob">
          <AmountInput id="acc-ob" value={opening} onChange={setOpening} placeholder="0" invalid={!!errors.opening} />
        </Field>
        <Field label={t("acc.opening_date")} error={E("openingDate")} htmlFor="acc-od">
          <Input id="acc-od" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        </Field>
        {!isCard && (
          <div className="sm:col-span-2">
            <Checkbox label={t("acc.overdrawn")} checked={openingNeg} onChange={setOpeningNeg} />
          </div>
        )}
        {type !== "cash" && (
          <Field label={t("acc.institution")} htmlFor="acc-inst">
            <Input id="acc-inst" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={120} placeholder={t("acc.institution_ph")} />
          </Field>
        )}
        {type !== "cash" && (
          <Field label={t("acc.last4")} error={E("last4")} hint={t("acc.last4_hint")} htmlFor="acc-l4">
            <Input id="acc-l4" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        {isCard && (
          <Field label={t("acc.credit_limit")} error={E("limit")} htmlFor="acc-lim">
            <AmountInput id="acc-lim" value={limit} onChange={setLimit} />
          </Field>
        )}
        {type === "fixed_deposit" && (
          <Field label={t("acc.maturity")} htmlFor="acc-mat">
            <Input id="acc-mat" type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
          </Field>
        )}
        {(type === "fixed_deposit" || type === "savings") && (
          <Field label={t("acc.rate")} error={E("rate")} htmlFor="acc-rate">
            <Input id="acc-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="8.5" />
          </Field>
        )}
        <Field label={t("acc.color")} htmlFor="acc-color">
          <div className="flex items-center gap-2">
            <input id="acc-color" type="color" value={color || ACCOUNT_COLORS[type]} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface" />
            {color && (
              <button type="button" className="text-sm text-muted hover:underline" onClick={() => setColor("")}>
                {t("acc.color_default")}
              </button>
            )}
          </div>
        </Field>
      </div>
      <Checkbox label={t("acc.liquid")} checked={liquid} onChange={setLiquid} />
      <p className="-mt-2 text-xs text-muted">{t("acc.liquid_hint")}</p>
      <Field label={t("f.notes")} htmlFor="acc-notes">
        <Textarea id="acc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      <Alert tone="info">{t("acc.security_note")}</Alert>
      {formError && <Alert tone="neg">{formError}</Alert>}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {editing ? t("common.save_changes") : t("acc.add")}
        </Button>
      </div>
    </form>
  );
}
