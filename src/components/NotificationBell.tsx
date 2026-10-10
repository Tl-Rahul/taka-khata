"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useI18n, type I18n } from "@/lib/i18n/I18nProvider";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import type { Notice } from "@/lib/finance/notifications";
import type { Dataset } from "@/lib/finance/types";
import { cx, IconButton } from "./ui";

export function noticeText(n: Notice, i: I18n, ds: Dataset): { title: string; detail: string } {
  const { t, money, date } = i;
  if (n.kind === "budget") {
    const b = ds.budgets.find((x) => x.id === n.refId);
    const cat = b?.category_id ? ds.categories.find((c) => c.id === b.category_id) : null;
    const name = cat ? i.catName(cat) : t("budget.overall");
    return {
      title: t(n.severity === "danger" ? "notice.budget_over" : "notice.budget_near", { name, pct: i.pct(n.ratio ?? 0) }),
      detail: (n.amount ?? 0) >= 0 ? t("budget.left", { amount: money(n.amount ?? 0) }) : t("budget.over_by", { amount: money(-(n.amount ?? 0)) }),
    };
  }
  const days = n.days ?? 0;
  const when = days < 0 ? t("when.overdue_days", { n: -days }) : days === 0 ? t("when.today") : days === 1 ? t("when.tomorrow") : t("when.in_days", { n: days });
  return {
    title: t(`notice.${n.kind}`, { name: n.title }),
    detail: `${money(n.amount ?? 0)} · ${date(n.date)} · ${when}`,
  };
}

const DISMISS_KEY = "dismissedNotices";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function useNotices() {
  const { notices } = useDerived();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => setDismissed(loadDismissed()), []);
  const visible = useMemo(() => notices.filter((n) => !dismissed.has(n.id)), [notices, dismissed]);
  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    // keep the list bounded to ids that still exist
    const live = new Set(notices.map((n) => n.id));
    const pruned = [...next].filter((x) => live.has(x));
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(pruned));
    } catch {}
    setDismissed(new Set(pruned));
  };
  return { visible, all: notices, dismiss };
}

export function NotificationBell() {
  const i = useI18n();
  const { ds, today } = useData();
  const { visible, dismiss } = useNotices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // optional browser notifications, at most once per notice per day
  useEffect(() => {
    if (!ds.profile?.reminders.browser || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const n of visible.filter((x) => x.severity !== "info").slice(0, 3)) {
      const key = `notified:${n.id}:${today}`;
      try {
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, "1");
      } catch {
        continue;
      }
      const txt = noticeText(n, i, ds);
      try {
        new Notification(txt.title, { body: txt.detail, icon: "/icon.svg", tag: n.id });
      } catch {}
    }
  }, [visible, ds, today, i]);

  const urgent = visible.filter((n) => n.severity !== "info").length;

  return (
    <div className="relative" ref={ref}>
      <IconButton label={i.t("notice.title")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Bell className="size-5" />
        {visible.length > 0 && (
          <span className={cx("absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-4 text-white", urgent ? "bg-neg" : "bg-info")}>
            {i.digits(visible.length > 9 ? "9+" : visible.length)}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="sheet-in absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-semibold">{i.t("notice.title")}</span>
            <Link href="/settings#reminders" className="text-sm text-brand hover:underline" onClick={() => setOpen(false)}>
              {i.t("notice.settings")}
            </Link>
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{i.t("notice.empty")}</p>
          ) : (
            <ul className="max-h-[60dvh] divide-y divide-line overflow-y-auto">
              {visible.map((n) => {
                const txt = noticeText(n, i, ds);
                return (
                  <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.severity === "danger" ? "bg-neg" : n.severity === "warning" ? "bg-warn" : "bg-info")} />
                    <Link href={n.href} className="min-w-0 flex-1" onClick={() => setOpen(false)}>
                      <p className="text-[15px] font-medium leading-snug">{txt.title}</p>
                      <p className="num text-sm text-muted">{txt.detail}</p>
                    </Link>
                    <button type="button" className="p-1 text-muted hover:text-ink" aria-label={i.t("notice.dismiss")} onClick={() => dismiss(n.id)}>
                      <X className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
