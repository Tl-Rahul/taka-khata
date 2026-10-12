"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Paperclip, Trash2 } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived, loanName } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { deleteReceipt, receiptUrl, uploadReceipt } from "@/lib/data/receipts";
import { parseAmount } from "@/lib/finance/money";
import { checkDraft, hasErrors, type TxDraft } from "@/lib/finance/validation";
import { computeBalances, compareTxDesc } from "@/lib/finance/engine";
import { suggestSplit } from "@/lib/finance/loans";
import { addDays } from "@/lib/finance/dates";
import type { Contact, Frequency, InterestType, Loan, Recurring, Transaction, TxType } from "@/lib/finance/types";
import { FREQUENCIES } from "@/lib/finance/types";
import { useDeleteTx } from "./txActions";
import { AccountSelect, AmountInput, CategorySelect, ContactInput, findContactByName } from "./fields";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, cx, useFeedback } from "./ui";

export interface TxFormPreset extends Partial<Transaction> {
  type: TxType;
}

const LOAN_TYPES: TxType[] = ["borrow", "lend", "debt_repayment", "collection"];
const p2s = (p: number | null | undefined) => (p ? String(p / 100) : "");

function lastAccountKey(type: TxType) {
  return `lastAccount:${type}`;
}

export function TransactionForm({ preset, editing, onDone, onCancel }: { preset?: TxFormPreset; editing?: Transaction; onDone: (tx: Transaction) => void; onCancel: () => void }) {
  const { ds, today, insert, update, remove, userId } = useData();
  const { activeAccounts, loanStatuses, contactMap, balances } = useDerived();
  const { t, money, date: fmtDate, catName } = useI18n();
  const { toast } = useFeedback();
  const deleteTx = useDeleteTx();
  const src = editing ?? preset;
  const type: TxType = (editing?.type ?? preset?.type ?? "expense") as TxType;

  const defaultAccount = () => {
    if (src?.account_id) return src.account_id;
    try {
      const saved = localStorage.getItem(lastAccountKey(type));
      if (saved && activeAccounts.some((a) => a.id === saved)) return saved;
    } catch {}
    return activeAccounts.find((a) => a.type === "cash")?.id ?? activeAccounts[0]?.id ?? "";
  };

  const [amount, setAmount] = useState(type === "adjustment" ? "" : p2s(src?.amount));
  const [interest, setInterest] = useState(p2s(src?.interest));
  const [fee, setFee] = useState(p2s(src?.fee));
  const [showFee, setShowFee] = useState(Boolean(src?.fee));
  const [date, setDate] = useState(src?.date ?? today);
  const [accountId, setAccountId] = useState(defaultAccount);
  const [toAccountId, setToAccountId] = useState(src?.to_account_id ?? "");
  const [categoryId, setCategoryId] = useState(src?.category_id ?? "");
  const [description, setDescription] = useState(src?.description ?? "");
  const [notes, setNotes] = useState(src?.notes ?? "");
  const [showNotes, setShowNotes] = useState(Boolean(src?.notes));
  const [refundOf, setRefundOf] = useState(src?.refund_of ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [attachment, setAttachment] = useState<string | null>(src?.attachment_path ?? null);
  const [repeat, setRepeat] = useState<"" | Frequency>("");

  // loans
  const direction = type === "borrow" || type === "debt_repayment" ? "borrowed" : "lent";
  const loansForType = ds.loans.filter((l) => l.direction === direction && (!l.closed || l.id === src?.loan_id));
  const [loanId, setLoanId] = useState<string>(src?.loan_id ?? (type === "borrow" || type === "lend" ? "new" : loansForType.find((l) => !loanStatuses.get(l.id)?.isSettled)?.id ?? ""));
  const [person, setPerson] = useState(src?.contact_id ? contactMap.get(src.contact_id)?.name ?? "" : "");
  const [loanTitle, setLoanTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("none");
  const [rate, setRate] = useState("");
  const [fixedInterest, setFixedInterest] = useState("");
  const [plan, setPlan] = useState(false);
  const [instAmount, setInstAmount] = useState("");
  const [instFreq, setInstFreq] = useState<Frequency>("monthly");
  const [instCount, setInstCount] = useState("");
  const [instFirst, setInstFirst] = useState("");

  // adjustment: user enters the real balance; we record the difference
  const adjBase = useMemo(() => {
    if (type !== "adjustment" || !accountId) return 0;
    const acc = ds.accounts.find((a) => a.id === accountId);
    if (!acc) return 0;
    return computeBalances([acc], ds.transactions.filter((x) => x.id !== editing?.id)).get(acc.id) ?? 0;
  }, [type, accountId, ds.accounts, ds.transactions, editing?.id]);
  const [target, setTarget] = useState(() => (type === "adjustment" && editing ? String((adjBase + editing.amount) / 100) : ""));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const ackRef = useRef<string>("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isLoanType = LOAN_TYPES.includes(type);
  const isPayment = type === "debt_repayment" || type === "collection";
  const status = loanId && loanId !== "new" ? loanStatuses.get(loanId) : undefined;
  const catKind = type === "income" ? "income" : "expense";
  const needsCategory = type === "income" || type === "expense" || type === "refund";
  const canAttach = type === "expense" || type === "income" || type === "refund" || isPayment;
  const feeAllowed = ["income", "transfer", "borrow", "lend", "debt_repayment", "collection"].includes(type);

  // recent categories for one-tap picking
  const recentCats = useMemo(() => {
    if (!needsCategory) return [];
    const seen: string[] = [];
    for (const x of [...ds.transactions].sort(compareTxDesc)) {
      if (x.type === (type === "refund" ? "expense" : type) && x.category_id && !seen.includes(x.category_id)) seen.push(x.category_id);
      if (seen.length >= 6) break;
    }
    return seen.map((id) => ds.categories.find((c) => c.id === id)).filter((c) => c && !c.archived);
  }, [ds.transactions, ds.categories, type, needsCategory]);

  // refund candidates: recent expenses
  const refundable = useMemo(
    () =>
      type === "refund"
        ? ds.transactions
            .filter((x) => x.type === "expense" && x.date >= addDays(today, -180))
            .sort(compareTxDesc)
            .slice(0, 80)
        : [],
    [type, ds.transactions, today],
  );

  useEffect(() => {
    if (type !== "refund" || !refundOf) return;
    const orig = ds.transactions.find((x) => x.id === refundOf);
    if (orig) {
      setCategoryId(orig.category_id ?? "");
      if (!editing) setAccountId(orig.account_id);
    }
  }, [refundOf, type, ds.transactions, editing]);

  function buildDraft(loanIdForCheck: string | null): TxDraft | null {
    let amt: number | null;
    if (type === "adjustment") {
      const tgt = parseAmount(target, { allowNegative: true });
      amt = tgt === null ? null : tgt - adjBase;
    } else amt = isPayment && amount.trim() === "" ? 0 : parseAmount(amount);
    const intr = interest.trim() ? parseAmount(interest) : 0;
    const f = showFee && fee.trim() ? parseAmount(fee) : 0;
    const errs: Record<string, string> = {};
    if (amt === null) errs.amount = "v.amount";
    if (intr === null) errs.interest = "v.amount";
    if (f === null) errs.fee = "v.amount";
    if (Object.keys(errs).length) {
      setErrors(errs);
      return null;
    }
    return {
      id: editing?.id ?? crypto.randomUUID(),
      type,
      date,
      amount: amt!,
      interest: isPayment ? intr! : 0,
      fee: feeAllowed ? f! : 0,
      account_id: accountId,
      to_account_id: type === "transfer" ? toAccountId || null : null,
      category_id: needsCategory ? categoryId || null : null,
      contact_id: null,
      loan_id: isLoanType ? loanIdForCheck : null,
      recurring_id: editing?.recurring_id ?? preset?.recurring_id ?? null,
      occurrence_date: editing?.occurrence_date ?? preset?.occurrence_date ?? null,
      refund_of: type === "refund" ? refundOf || null : null,
      description: description.trim() || null,
      notes: notes.trim() || null,
      attachment_path: attachment,
      import_hash: editing?.import_hash ?? preset?.import_hash ?? null,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const newLoan = isLoanType && loanId === "new";
    const errs: Record<string, string> = {};
    let pendingLoan: Loan | null = null;
    let existingContact: Contact | undefined;

    if (newLoan) {
      if (!person.trim()) errs.person = "v.person";
      existingContact = findContactByName(ds.contacts, person);
      const r = interestType === "simple_annual" ? Number(rate.replace(",", ".")) : null;
      if (interestType === "simple_annual" && (!Number.isFinite(r) || r! < 0 || r! > 1000)) errs.rate = "v.rate";
      if (interestType === "fixed" && parseAmount(fixedInterest) === null) errs.fixedInterest = "v.amount";
      if (dueDate && dueDate < date) errs.dueDate = "v.due_before_start";
      if (plan) {
        if (parseAmount(instAmount) === null || parseAmount(instAmount) === 0) errs.instAmount = "v.amount";
        const c = Number(instCount);
        if (!Number.isInteger(c) || c < 1 || c > 1200) errs.instCount = "v.count";
        if (!instFirst) errs.instFirst = "v.date";
      }
      pendingLoan = {
        id: crypto.randomUUID(),
        direction,
        contact_id: existingContact?.id ?? "pending-contact",
        title: loanTitle.trim() || null,
        opening_principal: 0,
        opening_interest_due: 0,
        start_date: date,
        due_date: dueDate || null,
        interest_type: interestType,
        interest_rate: interestType === "simple_annual" ? Number(rate.replace(",", ".")) : null,
        fixed_interest: interestType === "fixed" ? parseAmount(fixedInterest) : null,
        installment_amount: plan ? parseAmount(instAmount) : null,
        installment_frequency: plan ? instFreq : null,
        installment_count: plan ? Number(instCount) : null,
        first_installment_date: plan ? instFirst : null,
        notes: null,
        closed: false,
      };
    }
    const draft = buildDraft(newLoan ? pendingLoan!.id : loanId || null);
    if (!draft) return;
    const check = checkDraft(draft, pendingLoan ? { ...ds, loans: [...ds.loans, pendingLoan] } : ds, today);
    const allErrs = { ...errs, ...(check.errors as Record<string, string>) };
    setErrors(allErrs);
    if (Object.keys(allErrs).length || hasErrors(check)) return;

    // warnings must be seen once before saving
    const sig = check.warnings.join(",");
    setWarnings(check.warnings);
    if (check.warnings.length && ackRef.current !== sig) {
      ackRef.current = sig;
      return;
    }

    setSaving(true);
    const created: Array<{ table: "contacts" | "loans" | "recurring"; id: string }> = [];
    let uploaded: string | null = null;
    try {
      if (newLoan && pendingLoan) {
        let contactId = existingContact?.id;
        if (!contactId) {
          const c = await insert<Contact>("contacts", { name: person.trim(), kind: "person" });
          contactId = c.id;
          created.push({ table: "contacts", id: c.id });
        }
        const l = await insert<Loan>("loans", { ...pendingLoan, contact_id: contactId });
        created.push({ table: "loans", id: l.id });
      }
      if (file && userId) {
        uploaded = await uploadReceipt(userId, file);
        draft.attachment_path = uploaded;
      }
      if (!editing && repeat && (type === "income" || type === "expense")) {
        const r = await insert<Recurring>("recurring", {
          kind: type,
          name: description.trim() || catName(ds.categories.find((c) => c.id === categoryId)),
          amount: draft.amount,
          account_id: draft.account_id,
          category_id: draft.category_id,
          frequency: repeat,
          interval_count: 1,
          start_date: date,
          is_bill: type === "expense",
          remind_days_before: ds.profile?.reminders.days_before ?? 3,
          active: true,
          skipped_dates: [],
        });
        created.push({ table: "recurring", id: r.id });
        draft.recurring_id = r.id;
        draft.occurrence_date = date;
      }
      let saved: Transaction;
      if (editing) {
        const { id, ...patch } = draft;
        saved = await update<Transaction>("transactions", id, patch);
        if (editing.attachment_path && editing.attachment_path !== saved.attachment_path) deleteReceipt(editing.attachment_path).catch(() => {});
      } else {
        saved = await insert<Transaction>("transactions", draft);
      }
      try {
        localStorage.setItem(lastAccountKey(type), accountId);
      } catch {}
      toast(t(editing ? "toast.tx_updated" : "toast.tx_saved"));
      onDone(saved);
    } catch (err) {
      // roll back helper rows created for this save so nothing is left half-done
      for (const c of created.reverse()) await remove(c.table, c.id).catch(() => {});
      if (uploaded) deleteReceipt(uploaded).catch(() => {});
      const msg = err instanceof Error && err.message.startsWith("receipt.") ? t(err.message) : errorText(err, t);
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  const E = (k: string) => (errors[k] ? t(errors[k]) : null);
  const total = (parseAmount(amount) ?? 0) + (isPayment ? parseAmount(interest) ?? 0 : 0) + (showFee ? parseAmount(fee) ?? 0 : 0);

  if (!activeAccounts.length) {
    return (
      <div className="space-y-4">
        <Alert tone="info" title={t("tx.need_account_title")}>
          {t("tx.need_account_body")}
        </Alert>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => (window.location.href = "/accounts?new=1")}>{t("acc.add")}</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {/* amount first: the thing you always type */}
      {type === "adjustment" ? (
        <>
          <Field label={t("f.account")} error={E("account_id")} htmlFor="tx-account">
            <AccountSelect id="tx-account" value={accountId} onChange={setAccountId} invalid={!!errors.account_id} />
          </Field>
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            {t("adj.current")}: <span className="num font-semibold">{money(adjBase)}</span>
          </div>
          <Field label={t("adj.actual")} error={E("amount")} hint={t("adj.hint")} htmlFor="tx-target">
            <AmountInput id="tx-target" big value={target} onChange={setTarget} allowNegative invalid={!!errors.amount} data-autofocus />
          </Field>
          {(() => {
            const tg = parseAmount(target, { allowNegative: true });
            if (tg === null) return null;
            const diff = tg - adjBase;
            return (
              <p className="text-sm text-muted">
                {t("adj.diff")}: <span className={cx("num font-semibold", diff < 0 ? "text-neg" : "text-brand")}>{money(diff, { signed: true })}</span>
              </p>
            );
          })()}
        </>
      ) : (
        <Field label={isPayment ? t("f.principal") : t("f.amount")} error={E("amount") ?? E("total")} htmlFor="tx-amount">
          <AmountInput id="tx-amount" big value={amount} onChange={setAmount} invalid={!!errors.amount || !!errors.total} placeholder="0" data-autofocus />
        </Field>
      )}

      {/* loan selection */}
      {isLoanType && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <Field label={direction === "borrowed" ? t("f.debt") : t("f.receivable")} error={E("loan_id")} htmlFor="tx-loan">
            <Select id="tx-loan" value={loanId} onChange={(e) => setLoanId(e.target.value)} invalid={!!errors.loan_id}>
              {(type === "borrow" || type === "lend") && <option value="new">{t("loan.new_option")}</option>}
              {isPayment && !loanId && <option value="">{t("f.choose")}</option>}
              {loansForType.map((l) => {
                const s = loanStatuses.get(l.id);
                return (
                  <option key={l.id} value={l.id}>
                    {loanName(l, contactMap)} — {money(s?.outstanding ?? 0)}
                  </option>
                );
              })}
            </Select>
          </Field>
          {isPayment && loansForType.length === 0 && <p className="text-sm text-muted">{direction === "borrowed" ? t("loan.none_debts") : t("loan.none_receivables")}</p>}

          {status && isPayment && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                {t("loan.outstanding")}: <b className="num">{money(status.outstanding)}</b>
              </span>
              {status.interestDue > 0 && (
                <span>
                  {t("loan.interest_due")}: <b className="num">{money(status.interestDue)}</b>
                </span>
              )}
              {status.nextDue && (
                <button
                  type="button"
                  className="text-brand underline-offset-2 hover:underline"
                  onClick={() => {
                    const sp = suggestSplit(status.nextDue!.amount, status);
                    setAmount(p2s(sp.principal) || "0");
                    setInterest(p2s(sp.interest));
                  }}
                >
                  {t("loan.fill_installment", { amount: money(status.nextDue.amount) })}
                </button>
              )}
              <button
                type="button"
                className="text-brand underline-offset-2 hover:underline"
                onClick={() => {
                  setAmount(p2s(status.outstanding) || "0");
                  setInterest(p2s(status.interestDue));
                }}
              >
                {t("loan.fill_full")}
              </button>
            </div>
          )}

          {loanId === "new" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={direction === "borrowed" ? t("loan.lender") : t("loan.borrower")} error={E("person")} htmlFor="loan-person">
                <ContactInput id="loan-person" value={person} onChange={setPerson} invalid={!!errors.person} placeholder={t("loan.person_ph")} />
              </Field>
              <Field label={t("loan.due_date")} error={E("dueDate")} htmlFor="loan-due">
                <Input id="loan-due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label={t("loan.interest_terms")} htmlFor="loan-int">
                <Select id="loan-int" value={interestType} onChange={(e) => setInterestType(e.target.value as InterestType)}>
                  <option value="none">{t("loan.int.none")}</option>
                  <option value="fixed">{t("loan.int.fixed")}</option>
                  <option value="simple_annual">{t("loan.int.simple_annual")}</option>
                </Select>
              </Field>
              {interestType === "simple_annual" && (
                <Field label={t("loan.rate")} error={E("rate")} htmlFor="loan-rate">
                  <Input id="loan-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="12" />
                </Field>
              )}
              {interestType === "fixed" && (
                <Field label={t("loan.fixed_interest")} error={E("fixedInterest")} htmlFor="loan-fixed">
                  <AmountInput id="loan-fixed" value={fixedInterest} onChange={setFixedInterest} />
                </Field>
              )}
              <Field label={t("loan.title")} className="sm:col-span-2" htmlFor="loan-title">
                <Input id="loan-title" value={loanTitle} onChange={(e) => setLoanTitle(e.target.value)} placeholder={t("loan.title_ph")} maxLength={120} />
              </Field>
              <div className="sm:col-span-2">
                <Checkbox label={t("loan.has_plan")} checked={plan} onChange={setPlan} />
              </div>
              {plan && (
                <>
                  <Field label={t("loan.inst_amount")} error={E("instAmount")} htmlFor="loan-ia">
                    <AmountInput id="loan-ia" value={instAmount} onChange={setInstAmount} />
                  </Field>
                  <Field label={t("loan.inst_freq")} htmlFor="loan-if">
                    <Select id="loan-if" value={instFreq} onChange={(e) => setInstFreq(e.target.value as Frequency)}>
                      {FREQUENCIES.map((f) => (
                        <option key={f} value={f}>
                          {t(`freq.${f}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("loan.inst_count")} error={E("instCount")} htmlFor="loan-ic">
                    <Input id="loan-ic" inputMode="numeric" value={instCount} onChange={(e) => setInstCount(e.target.value.replace(/\D/g, ""))} />
                  </Field>
                  <Field label={t("loan.inst_first")} error={E("instFirst")} htmlFor="loan-ifd">
                    <Input id="loan-ifd" type="date" value={instFirst} onChange={(e) => setInstFirst(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isPayment && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={type === "debt_repayment" ? t("f.interest_paid") : t("f.interest_received")} error={E("interest")} hint={t("f.interest_hint")} htmlFor="tx-interest">
            <AmountInput id="tx-interest" value={interest} onChange={setInterest} invalid={!!errors.interest} placeholder="0" />
          </Field>
          <div className="flex items-end pb-2 text-sm text-muted">
            {t("f.total")}: <span className="num ml-1 font-semibold text-ink">{money(total)}</span>
          </div>
        </div>
      )}

      {type === "refund" && (
        <Field label={t("refund.original")} hint={t("refund.original_hint")} htmlFor="tx-refund">
          <Select id="tx-refund" value={refundOf} onChange={(e) => setRefundOf(e.target.value)}>
            <option value="">{t("refund.none")}</option>
            {refundable.map((x) => (
              <option key={x.id} value={x.id}>
                {fmtDate(x.date)} — {x.description || catName(ds.categories.find((c) => c.id === x.category_id))} — {money(x.amount)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {needsCategory && (
        <Field label={t("f.category")} error={E("category_id")} htmlFor="tx-cat">
          {recentCats.length > 0 && !(type === "refund" && refundOf) && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {recentCats.map((c) => (
                <button
                  key={c!.id}
                  type="button"
                  onClick={() => setCategoryId(c!.id)}
                  className={cx(
                    "rounded-full border px-2.5 py-1 text-sm transition-colors",
                    categoryId === c!.id ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink",
                  )}
                >
                  {catName(c)}
                </button>
              ))}
            </div>
          )}
          <CategorySelect id="tx-cat" kind={catKind} value={categoryId} onChange={setCategoryId} invalid={!!errors.category_id} />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {type !== "adjustment" && (
          <Field
            label={type === "transfer" ? t("f.from_account") : type === "income" || type === "borrow" || type === "collection" || type === "refund" ? t("f.to_account_received") : t("f.paid_from")}
            error={E("account_id")}
            htmlFor="tx-account"
          >
            <AccountSelect id="tx-account" value={accountId} onChange={setAccountId} invalid={!!errors.account_id} />
          </Field>
        )}
        {type === "transfer" && (
          <Field label={t("f.to_account")} error={E("to_account_id")} htmlFor="tx-to">
            <AccountSelect id="tx-to" value={toAccountId} onChange={setToAccountId} exclude={accountId} invalid={!!errors.to_account_id} />
          </Field>
        )}
        <Field label={t("f.date")} error={E("date")} htmlFor="tx-date">
          <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errors.date} required />
        </Field>
      </div>

      <Field label={t("f.description")} htmlFor="tx-desc">
        <Input id="tx-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder={t(`ph.desc.${type}`)} />
      </Field>

      {feeAllowed && (
        <div>
          {!showFee ? (
            <button type="button" className="text-sm text-brand hover:underline" onClick={() => setShowFee(true)}>
              + {t("f.add_fee")}
            </button>
          ) : (
            <Field label={t("f.fee")} error={E("fee")} hint={t("f.fee_hint")} htmlFor="tx-fee">
              <AmountInput id="tx-fee" value={fee} onChange={setFee} invalid={!!errors.fee} placeholder="0" />
            </Field>
          )}
        </div>
      )}

      {!showNotes ? (
        <button type="button" className="text-sm text-brand hover:underline" onClick={() => setShowNotes(true)}>
          + {t("f.add_notes")}
        </button>
      ) : (
        <Field label={t("f.notes")} htmlFor="tx-notes">
          <Textarea id="tx-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
      )}

      {canAttach && (
        <Field label={t("f.receipt")}>
          {attachment && !file ? (
            <div className="flex items-center gap-2 text-sm">
              <Paperclip className="size-4 text-muted" />
              <button
                type="button"
                className="inline-flex items-center gap-1 text-brand hover:underline"
                onClick={async () => {
                  try {
                    window.open(await receiptUrl(attachment), "_blank", "noopener");
                  } catch {
                    toast(t("receipt.open_failed"), "neg");
                  }
                }}
              >
                {t("receipt.view")} <ExternalLink className="size-3.5" />
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-neg hover:underline" onClick={() => setAttachment(null)}>
                <Trash2 className="size-3.5" /> {t("receipt.remove")}
              </button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              capture={undefined}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink"
            />
          )}
        </Field>
      )}

      {!editing && !preset?.recurring_id && (type === "income" || type === "expense") && (
        <Field label={t("f.repeat")} htmlFor="tx-repeat" hint={repeat ? t("f.repeat_hint") : undefined}>
          <Select id="tx-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as "" | Frequency)}>
            <option value="">{t("f.repeat_none")}</option>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`freq.${f}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {warnings.length > 0 && (
        <Alert tone="warn" title={t("w.title")}>
          <ul className="list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{t(w, { balance: money(balances.get(accountId) ?? 0) })}</li>
            ))}
          </ul>
          <p className="mt-1">{t("w.save_again")}</p>
        </Alert>
      )}
      {formError && <Alert tone="neg">{formError}</Alert>}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-line bg-surface px-4 pt-3 pb-1 sm:-mx-5 sm:px-5">
        {editing && (
          <Button
            variant="ghost"
            className="mr-auto text-neg"
            icon={<Trash2 className="size-4" />}
            disabled={saving}
            onClick={async () => {
              if (await deleteTx(editing)) onCancel();
            }}
          >
            {t("common.delete")}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {warnings.length && ackRef.current ? t("common.save_anyway") : editing ? t("common.save_changes") : t(`tx.save.${type}`)}
        </Button>
      </div>
    </form>
  );
}
