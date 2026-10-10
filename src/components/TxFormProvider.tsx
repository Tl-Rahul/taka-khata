"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, HandCoins, Handshake, RotateCcw, Scale, Undo2, Wallet, Banknote } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Transaction, TxType } from "@/lib/finance/types";
import { Modal, cx } from "./ui";
import { TransactionForm, type TxFormPreset } from "./TransactionForm";

interface Ctx {
  openTx: (o: { preset?: TxFormPreset; editing?: Transaction; onSaved?: (t: Transaction) => void }) => void;
  openQuickAdd: () => void;
}
const C = createContext<Ctx | null>(null);

export const QUICK_TYPES: Array<{ type: TxType; icon: ReactNode; tone: string }> = [
  { type: "expense", icon: <ArrowUpRight />, tone: "text-neg bg-neg-soft" },
  { type: "income", icon: <ArrowDownLeft />, tone: "text-brand bg-brand-soft" },
  { type: "transfer", icon: <ArrowLeftRight />, tone: "text-info bg-info-soft" },
  { type: "lend", icon: <Handshake />, tone: "text-warn bg-warn-soft" },
  { type: "borrow", icon: <HandCoins />, tone: "text-warn bg-warn-soft" },
  { type: "debt_repayment", icon: <Banknote />, tone: "text-neg bg-neg-soft" },
  { type: "collection", icon: <Wallet />, tone: "text-brand bg-brand-soft" },
  { type: "refund", icon: <Undo2 />, tone: "text-brand bg-brand-soft" },
  { type: "adjustment", icon: <Scale />, tone: "text-muted bg-surface-2" },
];

export function TxFormProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<null | { preset?: TxFormPreset; editing?: Transaction; onSaved?: (t: Transaction) => void; key: number }>(null);
  const [picker, setPicker] = useState(false);
  const openTx = useCallback<Ctx["openTx"]>((o) => {
    setPicker(false);
    setState({ ...o, key: Date.now() });
  }, []);
  const openQuickAdd = useCallback(() => setPicker(true), []);
  const type = state?.editing?.type ?? state?.preset?.type ?? "expense";
  const close = useCallback(() => setState(null), []);
  return (
    <C.Provider value={{ openTx, openQuickAdd }}>
      {children}
      <Modal open={picker} onClose={() => setPicker(false)} title={t("qa.title")} size="md">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
          {QUICK_TYPES.map((q) => (
            <button
              key={q.type}
              type="button"
              onClick={() => openTx({ preset: { type: q.type } })}
              className="flex flex-col items-center gap-2 rounded-xl border border-line px-2 py-3 text-center text-sm font-medium hover:border-brand hover:bg-surface-2"
            >
              <span className={cx("flex size-10 items-center justify-center rounded-full [&_svg]:size-5", q.tone)}>{q.icon}</span>
              <span className="leading-tight">{t(`qa.${q.type}`)}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <RotateCcw className="size-3.5" /> {t("qa.tip")}
        </p>
      </Modal>
      <Modal open={!!state} onClose={close} title={t(state?.editing ? `tx.edit.${type}` : `tx.title.${type}`)} size="md">
        {state && (
          <TransactionForm
            key={state.key}
            preset={state.preset}
            editing={state.editing}
            onCancel={close}
            onDone={(saved) => {
              state.onSaved?.(saved);
              close();
            }}
          />
        )}
      </Modal>
    </C.Provider>
  );
}

export function useTxForm() {
  const v = useContext(C);
  if (!v) throw new Error("useTxForm outside TxFormProvider");
  return v;
}
