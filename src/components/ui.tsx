"use client";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-strong",
  secondary: "bg-surface-2 text-ink hover:bg-line",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-neg text-white hover:opacity-90",
  outline: "border border-line text-ink hover:bg-surface-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const sizes = { sm: "h-8 px-3 text-sm gap-1.5", md: "h-10 px-4 text-[15px] gap-2", lg: "h-12 px-5 text-base gap-2" };
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        sizes[size],
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink transition-colors", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
const CONTROL =
  "w-full rounded-lg border border-line bg-surface px-3 h-10 text-[15px] text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60";

export function Field({ label, error, hint, children, className, htmlFor }: { label?: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-muted">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-sm text-neg" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(CONTROL, invalid && "border-neg focus:border-neg focus:ring-neg/20", className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(CONTROL, "pr-8", invalid && "border-neg", className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
});

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, "h-auto min-h-[72px] py-2", className)} {...rest} />;
}

export function Checkbox({ label, checked, onChange, className, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; className?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx("flex items-center gap-2.5 text-[15px] cursor-pointer select-none", disabled && "opacity-50", className)}>
      <input id={id} type="checkbox" className="size-4 accent-[var(--brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 py-2 text-left text-[15px]">
      <span>{label}</span>
      <span className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-brand" : "bg-line")}>
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  );
}

/** Segmented control for small option sets. */
export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-lg bg-surface-2 p-1 gap-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium transition-colors whitespace-nowrap",
            size === "sm" ? "px-2.5 h-7 text-sm" : "px-3 h-8 text-[15px]",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------
export function Card({ children, className, id, as: As = "section" }: { children: ReactNode; className?: string; id?: string; as?: "section" | "div" | "article" }) {
  return (
    <As id={id} className={cx("scroll-mt-20 rounded-xl border border-line bg-surface shadow-card", className)}>
      {children}
    </As>
  );
}

export function CardHeader({ title, action, sub }: { title: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold leading-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="ledger-rule pb-2">
        <h1 className="text-2xl font-semibold leading-tight sm:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, tone, sub, className }: { label: ReactNode; value: ReactNode; tone?: "pos" | "neg" | "warn" | "none"; sub?: ReactNode; className?: string }) {
  const tones = { pos: "text-brand", neg: "text-neg", warn: "text-warn", none: "text-ink" };
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-sm text-muted">{label}</div>
      <div className={cx("num mt-0.5 truncate text-xl font-semibold sm:text-[22px]", tones[tone ?? "none"])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "pos" | "neg" | "warn" | "info"; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    pos: "bg-brand-soft text-brand",
    neg: "bg-neg-soft text-neg",
    warn: "bg-warn-soft text-warn",
    info: "bg-info-soft text-info",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Progress({ ratio, tone, className, label }: { ratio: number; tone?: "pos" | "warn" | "neg" | "info"; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
  const tones = { pos: "bg-brand", warn: "bg-warn", neg: "bg-neg", info: "bg-info" };
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-[width]", tones[tone ?? "pos"])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon, title, body, action, className }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 text-muted [&_svg]:size-8">{icon}</div>}
      <p className="text-[16px] font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cx("flex items-center justify-center gap-2 text-muted", className)} role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function Alert({ tone = "info", children, className, title }: { tone?: "info" | "warn" | "neg" | "pos"; children?: ReactNode; className?: string; title?: ReactNode }) {
  const map = {
    info: ["bg-info-soft text-info", <Info key="i" className="size-4 shrink-0 mt-0.5" />],
    warn: ["bg-warn-soft text-warn", <AlertTriangle key="w" className="size-4 shrink-0 mt-0.5" />],
    neg: ["bg-neg-soft text-neg", <XCircle key="n" className="size-4 shrink-0 mt-0.5" />],
    pos: ["bg-brand-soft text-brand", <CheckCircle2 key="p" className="size-4 shrink-0 mt-0.5" />],
  } as const;
  const [cls, icon] = map[tone];
  return (
    <div className={cx("flex gap-2 rounded-lg px-3 py-2.5 text-sm", cls, className)} role={tone === "neg" ? "alert" : "status"}>
      {icon}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink/90">{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal / bottom sheet
// ---------------------------------------------------------------------------
const modalStack: string[] = [];
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    modalStack.push(titleId);
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== titleId) return; // only the top-most dialog reacts
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // focus once, right away, and never steal focus the person already moved inside the dialog
    const focusFirst = () => {
      if (!ref.current || ref.current.contains(document.activeElement)) return;
      const el = ref.current.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current.querySelector<HTMLElement>("input,select,textarea,button");
      el?.focus();
    };
    focusFirst();
    const t = setTimeout(focusFirst, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(titleId), 1);
      if (!modalStack.length) document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, titleId]);
  if (!open || !mounted) return null;
  const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-3xl" };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx("sheet-in relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-card sm:rounded-2xl", widths[size])}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-[17px] font-semibold">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Toasts and confirm dialog
// ---------------------------------------------------------------------------
type Toast = { id: number; tone: "pos" | "neg" | "info"; text: string };
interface FeedbackCtx {
  toast: (text: string, tone?: Toast["tone"]) => void;
  confirm: (o: { title: string; body?: ReactNode; confirmLabel: string; cancelLabel: string; danger?: boolean }) => Promise<boolean>;
}
const FbCtx = createContext<FeedbackCtx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<null | { title: string; body?: ReactNode; confirmLabel: string; cancelLabel: string; danger?: boolean; resolve: (v: boolean) => void }>(null);
  const toast = useCallback((text: string, tone: Toast["tone"] = "pos") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "neg" ? 7000 : 3500);
  }, []);
  const confirm = useCallback<FeedbackCtx["confirm"]>((o) => new Promise((resolve) => setDlg({ ...o, resolve })), []);
  const close = (v: boolean) => {
    dlg?.resolve(v);
    setDlg(null);
  };
  return (
    <FbCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "sheet-in pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-2.5 text-[15px] shadow-card",
              t.tone === "neg" ? "bg-neg text-white" : t.tone === "info" ? "bg-ink text-bg" : "bg-brand text-brand-ink",
            )}
          >
            {t.tone === "neg" ? <XCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!dlg}
        onClose={() => close(false)}
        title={dlg?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {dlg?.cancelLabel}
            </Button>
            <Button variant={dlg?.danger ? "danger" : "primary"} onClick={() => close(true)} data-autofocus>
              {dlg?.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-[15px] text-muted">{dlg?.body}</div>
      </Modal>
    </FbCtx.Provider>
  );
}

export function useFeedback() {
  const v = useContext(FbCtx);
  if (!v) throw new Error("useFeedback outside FeedbackProvider");
  return v;
}

/** Dot that shows a category/account color. */
export function Dot({ color, className }: { color?: string | null; className?: string }) {
  return <span className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color ?? "var(--muted)" }} aria-hidden />;
}
