"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Paisa } from "@/lib/finance/types";
import { Dot } from "./ui";

const AXIS = { fontSize: 12, fill: "var(--muted)" };
const FALLBACK_COLORS = ["#0b6e4f", "#2b67a6", "#c2417a", "#e07a1f", "#7c5cc4", "#1f9d8b", "#b8862b", "#d64545", "#5b6cd8", "#7a8580"];

function useTooltipStyle() {
  return {
    contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 13, color: "var(--ink)" },
    labelStyle: { color: "var(--muted)", marginBottom: 4 },
    itemStyle: { color: "var(--ink)", padding: 0 },
    cursor: { fill: "var(--surface-2)" },
  };
}

export function IncomeExpenseChart({ data, height = 240 }: { data: Array<{ label: string; income: Paisa; expense: Paisa }>; height?: number }) {
  const { t, money } = useI18n();
  const tt = useTooltipStyle();
  const rows = data.map((d) => ({ ...d, income: d.income / 100, expense: d.expense / 100 }));
  return (
    <div style={{ height }} role="img" aria-label={t("chart.income_vs_expense")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(Math.round(v * 100), { short: true, symbol: false })} />
          <Tooltip {...tt} formatter={(v, name) => [money(Math.round(Number(v) * 100)), name === "income" ? t("sum.income") : t("sum.expense")]} />
          <Legend formatter={(v) => <span style={{ color: "var(--muted)", fontSize: 13 }}>{v === "income" ? t("sum.income") : t("sum.expense")}</span>} iconType="circle" iconSize={8} />
          <Bar dataKey="income" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" fill="var(--neg)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutItem {
  id: string;
  label: string;
  value: Paisa;
  color?: string | null;
}

export function CategoryDonut({ items, total, centerLabel }: { items: DonutItem[]; total: Paisa; centerLabel: string }) {
  const { money, pct } = useI18n();
  const tt = useTooltipStyle();
  const top = items.slice(0, 7);
  const rest = items.slice(7).reduce((a, b) => a + b.value, 0);
  const data = [...top, ...(rest > 0 ? [{ id: "rest", label: "…", value: rest, color: "#9aa59f" }] : [])].map((d, i) => ({ ...d, color: d.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length], v: d.value / 100 }));
  return (
    <div className="flex flex-col items-stretch gap-4">
      <div className="relative mx-auto size-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="v" nameKey="label" innerRadius={58} outerRadius={86} paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.id} fill={d.color} />
              ))}
            </Pie>
            <Tooltip {...tt} formatter={(v) => money(Math.round(Number(v) * 100))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-muted">{centerLabel}</span>
          <span className="num text-[15px] font-semibold">{money(total, { short: true })}</span>
        </div>
      </div>
      <ul className="min-w-0 space-y-1.5">
        {data.map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-sm">
            <Dot color={d.color} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="num text-muted">{pct(total > 0 ? d.value / total : 0)}</span>
            <span className="num shrink-0 text-right font-medium">{money(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NetWorthChart({ data, height = 240 }: { data: Array<{ label: string; netWorth: Paisa; assets: Paisa; liabilities: Paisa }>; height?: number }) {
  const { t, money } = useI18n();
  const tt = useTooltipStyle();
  const rows = data.map((d) => ({ label: d.label, netWorth: d.netWorth / 100, assets: d.assets / 100, liabilities: d.liabilities / 100 }));
  const names: Record<string, string> = { netWorth: t("nw.net_worth"), assets: t("nw.assets"), liabilities: t("nw.liabilities") };
  return (
    <div style={{ height }} role="img" aria-label={t("chart.networth")}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(Math.round(v * 100), { short: true, symbol: false })} />
          <ReferenceLine y={0} stroke="var(--line)" />
          <Tooltip {...tt} formatter={(v, n) => [money(Math.round(Number(v) * 100)), names[String(n)] ?? n]} />
          <Legend formatter={(v) => <span style={{ color: "var(--muted)", fontSize: 13 }}>{names[v] ?? v}</span>} iconType="circle" iconSize={8} />
          <Line type="linear" dataKey="assets" stroke="var(--info)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          <Line type="linear" dataKey="liabilities" stroke="var(--neg)" strokeWidth={1.5} dot={false} />
          <Line type="linear" dataKey="netWorth" stroke="var(--brand)" strokeWidth={2.5} dot={{ r: 2.5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BudgetActualChart({ data, height = 220 }: { data: Array<{ label: string; budget: Paisa | null; actual: Paisa }>; height?: number }) {
  const { t, money } = useI18n();
  const tt = useTooltipStyle();
  const rows = data.map((d) => ({ label: d.label, budget: d.budget === null ? null : d.budget / 100, actual: d.actual / 100, over: d.budget !== null && d.actual > d.budget }));
  return (
    <div style={{ height }} role="img" aria-label={t("chart.budget_vs_actual")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(Math.round(v * 100), { short: true, symbol: false })} />
          <Tooltip {...tt} formatter={(v, n) => [v === null ? "—" : money(Math.round(Number(v) * 100)), n === "budget" ? t("budget.budget") : t("budget.spent")]} />
          <Legend formatter={(v) => <span style={{ color: "var(--muted)", fontSize: 13 }}>{v === "budget" ? t("budget.budget") : t("budget.spent")}</span>} iconType="circle" iconSize={8} />
          <Bar dataKey="budget" fill="var(--line)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="actual" radius={[4, 4, 0, 0]} maxBarSize={28} fill="var(--brand)">
            {rows.map((r, i) => (
              <Cell key={i} fill={r.over ? "var(--neg)" : "var(--brand)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** "Where your money is": one horizontal bar split by account. */
export function MoneyMap({ items }: { items: Array<{ id: string; label: string; value: Paisa; color?: string | null }> }) {
  const { money, pct } = useI18n();
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((a, b) => a + b.value, 0);
  if (total <= 0) return null;
  const colored = positive.map((d, i) => ({ ...d, color: d.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length] }));
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={colored.map((c) => `${c.label} ${money(c.value)}`).join(", ")}>
        {colored.map((d) => (
          <div key={d.id} style={{ width: `${(d.value / total) * 100}%`, background: d.color }} className="h-full border-r-2 border-surface last:border-r-0" title={`${d.label}: ${money(d.value)}`} />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {colored.map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-sm">
            <Dot color={d.color} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="num text-xs text-muted">{pct(d.value / total)}</span>
            <span className="num font-medium">{money(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { FALLBACK_COLORS };
