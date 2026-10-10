"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useData } from "@/lib/data/DataProvider";
import { monthPeriod, shiftPeriod, yearPeriod, isISODate, type Period, type PeriodKind } from "@/lib/finance/dates";
import { IconButton, Input, Segmented } from "./ui";

export function usePeriod(storageKey: string, initial: PeriodKind = "month") {
  const { today } = useData();
  const [p, setP] = useState<Period>(() => (initial === "year" ? yearPeriod(today) : monthPeriod(today)));
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`period:${storageKey}`);
      if (raw) {
        const v = JSON.parse(raw) as Period;
        if (isISODate(v.from) && isISODate(v.to) && v.from <= v.to) setP(v);
      }
    } catch {}
  }, [storageKey]);
  const set = (v: Period) => {
    setP(v);
    try {
      sessionStorage.setItem(`period:${storageKey}`, JSON.stringify(v));
    } catch {}
  };
  return [p, set] as const;
}

export function periodLabel(p: Period, i: ReturnType<typeof useI18n>) {
  if (p.kind === "month") return i.month(p.from.slice(0, 7));
  if (p.kind === "year") return i.digits(p.from.slice(0, 4));
  return `${i.date(p.from)} – ${i.date(p.to)}`;
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const i = useI18n();
  const { today } = useData();
  const { t } = i;
  const kind = value.kind;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        size="sm"
        value={kind}
        onChange={(k) => onChange(k === "month" ? monthPeriod(today) : k === "year" ? yearPeriod(today) : { kind: "custom", from: value.from, to: value.to })}
        options={[
          { value: "month", label: t("period.month") },
          { value: "year", label: t("period.year") },
          { value: "custom", label: t("period.custom") },
        ]}
      />
      {kind !== "custom" ? (
        <div className="flex items-center">
          <IconButton label={t("period.prev")} onClick={() => onChange(shiftPeriod(value, -1))}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <span className="min-w-[8.5rem] text-center text-[15px] font-medium">{periodLabel(value, i)}</span>
          <IconButton label={t("period.next")} onClick={() => onChange(shiftPeriod(value, 1))}>
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input type="date" className="h-8 w-[9.5rem] text-sm" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} aria-label={t("filter.from")} />
          <span className="text-muted">–</span>
          <Input type="date" className="h-8 w-[9.5rem] text-sm" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} aria-label={t("filter.to")} />
        </div>
      )}
    </div>
  );
}
