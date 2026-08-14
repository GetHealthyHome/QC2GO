import { useLayoutEffect, useRef } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white active:bg-brand-700 disabled:bg-ink-300',
  secondary: 'bg-white text-ink-800 border border-ink-200 active:bg-ink-100 disabled:text-ink-400',
  ghost: 'bg-transparent text-ink-600 active:bg-ink-100 disabled:text-ink-300',
  danger: 'bg-fail-600 text-white active:bg-fail-700 disabled:bg-ink-300',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  block,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed',
        BUTTON_STYLES[variant],
        block && 'w-full',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The white box everything sits in — unless the caller says otherwise.
 *
 * The base classes are dropped when the caller names their own, and that is not
 * a nicety. Two utilities from the same family on one element do not resolve by
 * the order they appear in the class attribute; the cascade decides, and
 * Tailwind emits `.bg-white` *after* every tinted `.bg-*`. So
 * `<Card className="bg-warn-50">` lost to this component's own base and rendered
 * plain white — silently, in nine places across seven screens, every one of
 * them a callout that was meant to be coloured because it was worth noticing.
 *
 * Matching on the class string is blunt, and it is the only thing available
 * here short of a class-merging dependency. It is narrow on purpose: a
 * background of any kind counts, and a border *colour* counts while a border
 * *width* does not, so `border-2` still gets the default ink border it expects.
 */
function names(className: string | undefined, pattern: RegExp): boolean {
  return className ? pattern.test(className) : false;
}

export function Card({
  children,
  className,
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  const ownBackground = names(className, /(^|\s)bg-/);
  const ownBorderColour = names(className, /(^|\s)border-[a-z]+-\d/);
  return (
    <As
      className={cx(
        'rounded-2xl border',
        ownBorderColour ? undefined : 'border-ink-200',
        ownBackground ? undefined : 'bg-white',
        className,
      )}
    >
      {children}
    </As>
  );
}

type Tone = 'neutral' | 'brand' | 'pass' | 'fail' | 'warn';

const BADGE_STYLES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  pass: 'bg-pass-50 text-pass-700',
  fail: 'bg-fail-50 text-fail-700',
  warn: 'bg-warn-50 text-warn-700',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        BADGE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  total,
  tone = 'brand',
  className,
}: {
  value: number;
  total: number;
  tone?: Tone;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  const fill =
    tone === 'fail' ? 'bg-fail-500' : tone === 'pass' ? 'bg-pass-500' : 'bg-brand-500';
  return (
    <div
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-ink-200', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cx('h-full rounded-full transition-all', fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-300 bg-white/60 px-6 py-12 text-center">
      {icon ? <div className="text-ink-300">{icon}</div> : null}
      <div>
        <p className="text-base font-semibold text-ink-800">{title}</p>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 flex items-center gap-1 text-[13px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-fail-600">*</span> : null}
      </span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-fail-600">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-ink-200 bg-white px-3.5 py-3 text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputClass, className)} {...props} />;
}

/**
 * Grows to fit its content. Checklist questions run long and a fixed-height box
 * hides the tail of the sentence an admin is trying to read.
 */
export function AutoTextarea({
  value,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      className={cx(inputClass, 'resize-none overflow-hidden', className)}
      {...props}
    />
  );
}

export function TopBar({
  title,
  subtitle,
  back,
  onBack,
  logo,
  actions,
  /** Off when the caller pins the bar itself, e.g. stacked above a progress header. */
  sticky = true,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  /**
   * Handle the back arrow instead of following `back` straight away.
   *
   * For a screen holding something unsaved. The arrow is the way people leave,
   * so a screen that guards its Cancel button and not this one does not guard
   * anything — it just hides the loss behind the less obvious exit.
   */
  onBack?: () => void;
  /**
   * Draw the wordmark instead of the title, for the screen that is the app
   * rather than a place inside it. `title` stays the accessible name, so a
   * screen reader still hears "QC2GO" and nothing has to be duplicated.
   */
  logo?: boolean;
  actions?: ReactNode;
  sticky?: boolean;
}) {
  const arrow = (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
  const backClass =
    '-ml-1 flex size-10 shrink-0 items-center justify-center rounded-xl text-white/80 active:bg-white/10';

  return (
    <header
      className={cx(
        'safe-pt border-b border-ink-800/40 bg-ink-900 text-white no-print',
        sticky && 'sticky top-0 z-30',
      )}
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
        {onBack ? (
          <button type="button" aria-label="Back" onClick={onBack} className={backClass}>
            {arrow}
          </button>
        ) : back ? (
          <Link to={back} aria-label="Back" className={backClass}>
            {arrow}
          </Link>
        ) : null}
        <div className="min-w-0 flex-1">
          {logo ? (
            <h1>
              <img
                src="/qc2go-logo.png"
                alt={title}
                width={720}
                height={214}
                className="h-6 w-auto"
              />
            </h1>
          ) : (
            <h1 className="truncate text-[17px] leading-tight font-semibold">{title}</h1>
          )}
          {subtitle ? <p className="truncate text-xs text-white/60">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('mx-auto w-full max-w-3xl px-3 py-4', className)}>{children}</div>
  );
}
