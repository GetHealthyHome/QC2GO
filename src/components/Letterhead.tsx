import { LOGO_SLOT } from '../lib/branding';
import { cx } from './ui';

/**
 * The logo area: a box of fixed size, reserved whether or not there is a logo
 * in it.
 *
 * Holding the space is the whole idea. A report laid out with the placeholder
 * is laid out identically once a company uploads its mark — nothing reflows, no
 * page break moves, and nobody has to re-check how the document sits on paper.
 * The dimensions come from `LOGO_SLOT` so this, the settings preview and the
 * downscaler cannot drift apart.
 */
export function LogoSlot({
  logo,
  companyName,
  className,
}: {
  logo?: string | null;
  companyName: string;
  className?: string;
}) {
  return (
    <div
      className={cx('flex shrink-0 items-center justify-start', className)}
      style={{ width: LOGO_SLOT.width, height: LOGO_SLOT.height }}
    >
      {logo ? (
        <img
          src={logo}
          // The company name, because for most companies the logo *is* the name
          // and a screen reader should not be left saying "image".
          alt={companyName}
          // Fitted, never cropped or stretched: a square badge lands narrower
          // than a wordmark rather than squashed into the same rectangle.
          className="max-h-full max-w-full object-contain object-left"
        />
      ) : (
        <div className="flex size-full items-center justify-center rounded-lg border-2 border-dashed border-ink-300 px-2 no-print-border">
          <span className="truncate text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
            {companyName}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The head of the report: the company on the left, the document's own identity
 * on the right. Shown on screen as well as in print — what an inspector hands
 * over should be what they were looking at.
 */
export function Letterhead({
  logo,
  companyName,
  title,
  meta,
}: {
  logo?: string | null;
  companyName: string;
  title: string;
  meta?: string;
}) {
  // Stacked on a phone, side by side from `sm` up and on paper. The slot keeps
  // its full size either way — it is over half the width of a narrow screen, so
  // sharing a row with it would squeeze the checklist name down to an ellipsis.
  return (
    <div className="mb-4 flex flex-col gap-3 border-b border-ink-200 pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 print:flex-row print:items-start print:justify-between">
      <LogoSlot logo={logo} companyName={companyName} />
      <div className="min-w-0 sm:pt-1 sm:text-right print:pt-1 print:text-right">
        <p className="text-[15px] leading-tight font-bold text-ink-900">{companyName}</p>
        <p className="text-[13px] leading-snug text-ink-600">{title}</p>
        {meta ? <p className="text-xs text-ink-500">{meta}</p> : null}
      </div>
    </div>
  );
}
