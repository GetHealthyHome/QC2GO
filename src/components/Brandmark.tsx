/**
 * The QC2GO mark, inline rather than an <img>.
 *
 * The screens that use it are the ones shown before anything else has loaded —
 * sign-in, the invitation landing, the no-company screen — and an <img> there
 * is a request that can still be in flight while somebody is looking at the
 * page. Inline, it is simply there.
 */
export function Brandmark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="none" strokeWidth="19" strokeLinecap="butt">
        <path d="M48 15 A 31 31 0 0 0 48 77" stroke="#E97132" />
        <path d="M48 15 A 31 31 0 0 1 67.9 69.7" stroke="#156082" />
      </g>
      <circle cx="79" cy="79" r="11.5" fill="#E97132" />
    </svg>
  );
}

/** The mark above the wordmark, as the app introduces itself. */
export function BrandLockup({ subtitle = 'Quality in motion' }: { subtitle?: string }) {
  return (
    <div className="flex flex-col items-center">
      <Brandmark className="size-16" title="QC2GO" />
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">QC2GO</h1>
      <p className="mt-1 text-sm text-white/60">{subtitle}</p>
    </div>
  );
}
