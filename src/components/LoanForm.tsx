"use client";
import { useState } from "react";
import { useData } from "@/lib/data/DataProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { parseAmount } from "@/lib/finance/money";
import { FREQUENCIES, type Contact, type Frequency, type InterestType, type Loan, type LoanDirection } from "@/lib/finance/types";
import { AmountInput, ContactInput, findContactByName } from "./fields";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, useFeedback } from "./ui";

const p2s = (p: number | null | undefined) => (p ? String(p / 100) : "");

/** Create a loan that already exists (no cash movement) or edit any loan's terms. */
export function LoanForm({ direction, editing, onDone, onCancel }: { direction: LoanDirection; editing?: Loan; onDone: (l: Loan) => void; onCancel: () => void }) {
  const { ds, insert, update, remove, today } = useData();
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [person, setPerson] = useState(editing ? ds.contacts.find((c) => c.id === editing.contact_id)?.name ?? "" : "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [opening, setOpening] = useState(p2s(editing?.opening_principal));
  const [openingInterest, setOpeningInterest] = useState(p2s(editing?.opening_interest_due));
  const [start, setStart] = useState(editing?.start_date ?? today);
  const [due, setDue] = useState(editing?.due_date ?? "");
  const [interestType, setInterestType] = useState<InterestType>(editing?.interest_type ?? "none");
  const [rate, setRate] = useState(editing?.interest_rate != null ? String(editing.interest_rate) : "");
  const [fixed, setFixed] = useState(p2s(editing?.fixed_interest));
  const [plan, setPlan] = useState(Boolean(editing?.installment_amount));
  const [instAmount, setInstAmount] = useState(p2s(editing?.installment_amount));
  const [instFreq, setInstFreq] = useState<Frequency>(editing?.installment_frequency ?? "monthly");
  const [instCount, setInstCount] = useState(editing?.installment_count ? String(editing.installment_count) : "");
  const [instFirst, setInstFirst] = useState(editing?.first_installment_date ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!person.trim()) errs.person = "v.person";
    const op = opening.trim() ? parseAmount(opening) : 0;
    if (op === null) errs.opening = "v.amount";
    if (!editing && !op) errs.opening = "v.opening_required";
    const oi = openingInterest.trim() ? parseAmount(openingInterest) : 0;
    if (oi === null) errs.openingInterest = "v.amount";
    if (!start) errs.start = "v.date";
    if (due && due < start) errs.due = "v.due_before_start";
    const r = interestType === "simple_annual" ? Number(rate.replace(",", ".")) : null;
    if (interestType === "simple_annual" && (!rate.trim() || !Number.isFinite(r) || r! < 0 || r! > 1000)) errs.rate = "v.rate";
    const fx = interestType === "fixed" ? parseAmount(fixed) : null;
    if (interestType === "fixed" && fx === null) errs.fixed = "v.amount";
    const ia = plan ? parseAmount(instAmount) : null;
    const ic = plan ? Number(instCount) : null;
    if (plan) {
      if (!ia) errs.instAmount = "v.amount";
      if (!Number.isInteger(ic) || ic! < 1 || ic! > 1200) errs.instCount = "v.count";
      if (!instFirst) errs.instFirst = "v.date";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setFormError(null);
    let createdContact: string | null = null;
    try {
      let contact = findContactByName(ds.contacts, person);
      if (!contact) {
        contact = await insert<Contact>("contacts", { name: person.trim(), kind: "person" });
        createdContact = contact.id;
      }
      const row: Partial<Loan> = {
        direction,
        contact_id: contact.id,
        title: title.trim() || null,
        opening_principal: op ?? 0,
        opening_interest_due: oi ?? 0,
        start_date: start,
        due_date: due || null,
        interest_type: interestType,
        interest_rate: r,
        fixed_interest: fx,
        installment_amount: plan ? ia : null,
        installment_frequency: plan ? instFreq : null,
        installment_count: plan ? ic : null,
        first_installment_date: plan ? instFirst : null,
        notes: notes.trim() || null,
      };
      const saved = editing ? await update<Loan>("loans", editing.id, row) : await insert<Loan>("loans", { ...row, closed: false });
      toast(t(editing ? "toast.loan_updated" : "toast.loan_added"));
      onDone(saved);
    } catch (err) {
      if (createdContact) await remove("contacts", createdContact).catch(() => {});
      setFormError(errorText(err, t));
    } finally {
      setSaving(false);
    }
  }
  const E = (k: string) => (errors[k] ? t(errors[k]) : null);
  const borrowed = direction === "borrowed";

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!editing && <Alert tone="info">{t(borrowed ? "loan.existing_hint_debt" : "loan.existing_hint_rec")}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={borrowed ? t("loan.lender") : t("loan.borrower")} error={E("person")} htmlFor="lf-person">
          <ContactInput id="lf-person" value={person} onChange={setPerson} invalid={!!errors.person} placeholder={t("loan.person_ph")} />
        </Field>
        <Field label={t("loan.title")} htmlFor="lf-title">
          <Input id="lf-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t("loan.title_ph")} />
        </Field>
        <Field label={t("loan.opening_principal")} error={E("opening")} hint={editing ? t("loan.opening_principal_hint_edit") : undefined} htmlFor="lf-op">
          <AmountInput id="lf-op" value={opening} onChange={setOpening} placeholder="0" invalid={!!errors.opening} />
        </Field>
        <Field label={t("loan.opening_interest")} error={E("openingInterest")} htmlFor="lf-oi">
          <AmountInput id="lf-oi" value={openingInterest} onChange={setOpeningInterest} placeholder="0" />
        </Field>
        <Field label={t("loan.start_date")} error={E("start")} htmlFor="lf-start">
          <Input id="lf-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t("loan.due_date")} error={E("due")} htmlFor="lf-due">
          <Input id="lf-due" type="date" value={due} min={start} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label={t("loan.interest_terms")} htmlFor="lf-int">
          <Select id="lf-int" value={interestType} onChange={(e) => setInterestType(e.target.value as InterestType)}>
            <option value="none">{t("loan.int.none")}</option>
            <option value="fixed">{t("loan.int.fixed")}</option>
            <option value="simple_annual">{t("loan.int.simple_annual")}</option>
          </Select>
        </Field>
        {interestType === "simple_annual" && (
          <Field label={t("loan.rate")} error={E("rate")} htmlFor="lf-rate">
            <Input id="lf-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="12" />
          </Field>
        )}
        {interestType === "fixed" && (
          <Field label={t("loan.fixed_interest")} error={E("fixed")} htmlFor="lf-fixed">
            <AmountInput id="lf-fixed" value={fixed} onChange={setFixed} />
          </Field>
        )}
      </div>
      <Checkbox label={t("loan.has_plan")} checked={plan} onChange={setPlan} />
      {plan && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("loan.inst_amount")} error={E("instAmount")} htmlFor="lf-ia">
            <AmountInput id="lf-ia" value={instAmount} onChange={setInstAmount} />
          </Field>
          <Field label={t("loan.inst_freq")} htmlFor="lf-if">
            <Select id="lf-if" value={instFreq} onChange={(e) => setInstFreq(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`freq.${f}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("loan.inst_count")} error={E("instCount")} htmlFor="lf-ic">
            <Input id="lf-ic" inputMode="numeric" value={instCount} onChange={(e) => setInstCount(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label={t("loan.inst_first")} error={E("instFirst")} htmlFor="lf-ifd">
            <Input id="lf-ifd" type="date" value={instFirst} onChange={(e) => setInstFirst(e.target.value)} />
          </Field>
        </div>
      )}
      <Field label={t("f.notes")} htmlFor="lf-notes">
        <Textarea id="lf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      {formError && <Alert tone="neg">{formError}</Alert>}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {editing ? t("common.save_changes") : t("loan.add_existing")}
        </Button>
      </div>
    </form>
  );
}
