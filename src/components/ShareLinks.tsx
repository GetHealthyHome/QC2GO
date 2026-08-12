import { useCallback, useEffect, useState } from 'react';
import { createShare, listShares, revokeShare, type ReportShare } from '../lib/shares';
import { formatDate } from '../lib/inspection';
import { Badge, Button, Card, Field, TextInput, cx } from './ui';
import { ShareIcon } from './Icons';

/**
 * The live links to one report, and the ability to take them down.
 *
 * A share is a bearer credential: whoever holds the link reads the report, with
 * no account and no sign-in. Handing one out is easy, so taking one back has to
 * be at least as easy — a link sent to the wrong address is an emergency, and
 * anything that makes somebody find an owner first is how it stays live for
 * another hour. Hence the list: every link on the record, who it was made for,
 * whether anybody has opened it, and one tap to end it.
 *
 * The token appears exactly once, when it is created. Only its hash reaches the
 * database, so nothing here can show an existing link again — which is why the
 * newly created one is held on screen until it is dismissed rather than flashed
 * past in an alert.
 */
export function ShareLinks({ inspectionId }: { inspectionId: string }) {
  const [shares, setShares] = useState<ReportShare[]>([]);
  const [creating, setCreating] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setShares(await listShares(inspectionId));
    } catch {
      // A list that cannot be loaded is not worth an error message on a report
      // somebody is reading. Creating and revoking both report for themselves.
      setShares([]);
    }
  }, [inspectionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    setCreating(true);
    setError(null);
    const result = await createShare(inspectionId, { days: 30, recipient });
    setCreating(false);

    if (result.error || !result.url) {
      setError(result.error ?? 'The link could not be created.');
      return;
    }
    setRecipient('');
    setFresh(result.url);
    // Best effort: the clipboard is refused in plenty of ordinary situations,
    // and the link is on screen to be copied by hand either way.
    setCopied(
      await navigator.clipboard?.writeText(result.url).then(
        () => true,
        () => false,
      ) ?? false,
    );
    await refresh();
  }

  async function revoke(share: ReportShare) {
    if (!confirm('Revoke this link? Anybody holding it will stop being able to open the report.')) {
      return;
    }
    const result = await revokeShare(share.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  return (
    <section className="mt-5 no-print">
      <h2 className="mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
        Shared links
      </h2>
      <Card className="p-4">
        <p className="text-[13px] leading-relaxed text-ink-600">
          A read-only copy of this report, openable without an account. Links last 30 days and can
          be revoked at any time.
        </p>

        <Field label="Who is it for? (optional)" className="mt-3">
          <TextInput
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="Homeowner, utility, GC…"
          />
        </Field>

        <Button variant="secondary" block className="mt-3" onClick={() => void create()} disabled={creating}>
          <ShareIcon className="size-5" />
          {creating ? 'Creating link…' : 'Create a link'}
        </Button>

        {error ? (
          <p className="mt-2 rounded-lg bg-fail-50 px-3 py-2 text-[13px] font-medium text-fail-700">
            {error}
          </p>
        ) : null}

        {fresh ? (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
            <p className="text-[13px] font-semibold text-brand-700">
              {copied ? 'Link copied.' : 'Copy this link now.'} It is not shown again.
            </p>
            <p className="mt-1.5 rounded-lg bg-white p-2 text-[12px] break-all text-ink-700 select-all">
              {fresh}
            </p>
            <Button variant="secondary" block className="mt-2" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        ) : null}

        {shares.length > 0 ? (
          <ul className="mt-3 flex flex-col divide-y divide-ink-100">
            {shares.map((share) => {
              const state = shareState(share);
              return (
                <li key={share.id} className="flex items-start gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cx(
                        'text-[14px] font-medium',
                        state === 'live' ? 'text-ink-900' : 'text-ink-400',
                      )}
                    >
                      {share.recipient || 'Anyone with the link'}
                    </p>
                    <p className="text-[12px] text-ink-500">
                      {state === 'revoked'
                        ? `Revoked ${formatDate(share.revokedAt!)}`
                        : state === 'expired'
                          ? `Expired ${formatDate(share.expiresAt)}`
                          : `Expires ${formatDate(share.expiresAt)}`}
                      {' · '}
                      {share.viewCount === 0
                        ? 'not opened yet'
                        : `opened ${share.viewCount} time${share.viewCount === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  {state === 'live' ? (
                    <Button
                      variant="secondary"
                      className="min-h-9 shrink-0 px-3 text-[13px]"
                      onClick={() => void revoke(share)}
                    >
                      Revoke
                    </Button>
                  ) : (
                    <Badge>{state === 'revoked' ? 'Revoked' : 'Expired'}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </section>
  );
}

function shareState(share: ReportShare): 'live' | 'revoked' | 'expired' {
  if (share.revokedAt) return 'revoked';
  return new Date(share.expiresAt).getTime() <= Date.now() ? 'expired' : 'live';
}
