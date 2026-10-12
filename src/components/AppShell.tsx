"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ChartColumn,
  CalendarClock,
  ChartPie,
  Ellipsis,
  HandCoins,
  Handshake,
  House,
  Landmark,
  MessageSquareText,
  Plus,
  Settings,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useData } from "@/lib/data/DataProvider";
import { useTxForm } from "./TxFormProvider";
import { NotificationBell } from "./NotificationBell";
import { Button, cx, Spinner } from "./ui";

export const NAV: Array<{ href: string; key: string; icon: ReactNode; group: 0 | 1 | 2 }> = [
  { href: "/", key: "nav.dashboard", icon: <House />, group: 0 },
  { href: "/transactions", key: "nav.transactions", icon: <ArrowLeftRight />, group: 0 },
  { href: "/income", key: "nav.income", icon: <TrendingUp />, group: 0 },
  { href: "/expenses", key: "nav.expenses", icon: <TrendingDown />, group: 0 },
  { href: "/accounts", key: "nav.accounts", icon: <Wallet />, group: 0 },
  { href: "/debts", key: "nav.debts", icon: <HandCoins />, group: 1 },
  { href: "/receivables", key: "nav.receivables", icon: <Handshake />, group: 1 },
  { href: "/bills", key: "nav.bills", icon: <CalendarClock />, group: 1 },
  { href: "/budgets", key: "nav.budgets", icon: <ChartPie />, group: 1 },
  { href: "/goals", key: "nav.goals", icon: <Target />, group: 1 },
  { href: "/net-worth", key: "nav.networth", icon: <Landmark />, group: 2 },
  { href: "/reports", key: "nav.reports", icon: <ChartColumn />, group: 2 },
  { href: "/sms", key: "nav.sms", icon: <MessageSquareText />, group: 2 },
  { href: "/import", key: "nav.import", icon: <Upload />, group: 2 },
  { href: "/settings", key: "nav.settings", icon: <Settings />, group: 2 },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

function NavLink({ href, label, icon, active, onClick }: { href: string; label: string; icon: ReactNode; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors [&_svg]:size-[18px]",
        active ? "bg-brand-soft font-semibold text-brand" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { status, error, reload } = useData();
  const { openQuickAdd } = useTxForm();
  const path = usePathname();
  const [more, setMore] = useState(false);

  useEffect(() => setMore(false), [path]);
  // "n" opens Quick Add (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !/input|textarea|select/i.test(el.tagName) && !el.isContentEditable && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        openQuickAdd();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openQuickAdd]);

  const groups = useMemo(() => [0, 1, 2].map((g) => NAV.filter((n) => n.group === g)), []);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="text-lg font-semibold leading-none">{t("app.name")}</span>
        </Link>
        <div className="px-3 pb-3">
          <Button className="w-full" onClick={openQuickAdd} icon={<Plus className="size-4" />}>
            {t("qa.button")}
          </Button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4" aria-label={t("nav.main")}>
          {groups.map((g, i) => (
            <div key={i} className="space-y-0.5">
              {g.map((n) => (
                <NavLink key={n.href} href={n.href} label={t(n.key)} icon={n.icon} active={isActive(path, n.href)} />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* top bar */}
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur lg:justify-end lg:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <img src="/icon.svg" alt="" className="size-7" />
            <span className="font-semibold">{t("app.name")}</span>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
          </div>
        </header>

        <main className="print-full mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pb-10">
          {status === "loading" ? (
            <Spinner className="py-24" label={t("common.loading")} />
          ) : status === "error" ? (
            <div className="mx-auto max-w-md py-20 text-center">
              <p className="text-lg font-semibold">{t("err.load_title")}</p>
              <p className="mt-1 text-sm text-muted">{t("err.load_body")}</p>
              <p className="mt-2 break-words text-xs text-muted">{error}</p>
              <Button className="mt-4" onClick={reload}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* mobile bottom bar */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label={t("nav.main")}>
        <div className="grid grid-cols-5 items-end">
          {[NAV[0], NAV[1]].map((n) => (
            <Link key={n.href} href={n.href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] [&_svg]:size-5", isActive(path, n.href) ? "text-brand" : "text-muted")}>
              {n.icon}
              {t(n.key)}
            </Link>
          ))}
          <div className="flex justify-center">
            <button type="button" onClick={openQuickAdd} aria-label={t("qa.button")} className="-mt-5 flex size-14 items-center justify-center rounded-full bg-brand text-brand-ink shadow-card ring-4 ring-bg">
              <Plus className="size-7" />
            </button>
          </div>
          <Link href="/accounts" className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] [&_svg]:size-5", isActive(path, "/accounts") ? "text-brand" : "text-muted")}>
            <Wallet />
            {t("nav.accounts")}
          </Link>
          <button type="button" onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted [&_svg]:size-5">
            <Ellipsis />
            {t("nav.more")}
          </button>
        </div>
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMore(false)} />
          <div className="sheet-in absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">{t("nav.more")}</span>
              <button type="button" aria-label={t("common.close")} onClick={() => setMore(false)} className="p-2 text-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {NAV.slice(2).map((n) => (
                <NavLink key={n.href} href={n.href} label={t(n.key)} icon={n.icon} active={isActive(path, n.href)} onClick={() => setMore(false)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
