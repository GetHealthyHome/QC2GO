import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import {
  addEndpoint,
  listDeliveries,
  listEndpoints,
  removeEndpoint,
  setEndpointActive,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '../lib/webhooks';
import { relativeTime } from '../lib/inspection';
import { Badge, Button, Card, Field, Screen, TextInput, TopBar, cx } from '../components/ui';
import { AlertIcon, CheckIcon, TrashIcon } from '../components/Icons';

/**
 * Where a company points QC2GO at its own systems.
 *
 * Owner-only, and not because of tidiness: the URL decides where a company's
 * inspection data goes and the secret beside it is a credential.
 */
export function IntegrationsScreen() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, recent] = await Promise.all([listEndpoints(), listDeliveries()]);
      setEndpoints(list);
      setDeliveries(recent);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not read the integrations.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    const result = await addEndpoint(url, description);
    if (result.error) setError(result.error);
    else {
      setUrl('');
      setDescription('');
      await refresh();
    }
    setBusy(false);
  }

  return (
    <>
      <TopBar title="Integrations" subtitle={profile?.organization?.name} back="/settings" />
      <Screen className="pb-10">
        <p className="mb-3 px-1 text-[13px] leading-relaxed text-ink-500">
          QC2GO posts a signed JSON body to each address below whenever an inspection is signed
          off. Failed deliveries are retried for a couple of hours before they are given up on.
        </p>

        {error ? (
          <p className="mb-3 flex items-start gap-1.5 rounded-xl bg-fail-50 px-3 py-2.5 text-[13px] font-medium text-fail-700">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        {isOwner ? (
          <Card className="p-4">
            <form onSubmit={add} className="flex flex-col gap-3">
              <Field label="Endpoint URL" hint="Must be https — inspection data does not go over http.">
                <TextInput
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/hooks/qc2go"
                  required
                />
              </Field>
              <Field label="What is it for" hint="Optional. Shown here so nobody has to guess later.">
                <TextInput
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="CRM — closes the job on pass"
                />
              </Field>
              <Button type="submit" block disabled={busy || !url.trim()}>
                {busy ? 'Adding…' : 'Add endpoint'}
              </Button>
            </form>
          </Card>
        ) : (
          <p className="mb-3 px-1 text-[13px] text-ink-500">
            Only an owner can add or change an endpoint.
          </p>
        )}

        <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Endpoints ({endpoints.length})
        </h2>

        {endpoints.length === 0 ? (
          <Card className="p-4">
            <p className="text-[13px] text-ink-500">
              Nothing is listening yet. Completed inspections are still recorded — they are just
              not sent anywhere.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {endpoints.map((endpoint) => (
              <Card key={endpoint.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-ink-900">{endpoint.url}</p>
                    {endpoint.description ? (
                      <p className="truncate text-xs text-ink-500">{endpoint.description}</p>
                    ) : null}
                  </div>
                  <Badge tone={endpoint.active ? 'pass' : 'neutral'}>
                    {endpoint.active ? 'Active' : 'Paused'}
                  </Badge>
                </div>

                {isOwner ? (
                  <>
                    <div className="mt-3 rounded-lg bg-ink-50 p-2.5">
                      <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                        Signing secret
                      </p>
                      {revealed === endpoint.id ? (
                        <p className="mt-0.5 font-mono text-[11px] leading-relaxed break-all text-ink-800">
                          {endpoint.secret}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRevealed(endpoint.id)}
                          className="mt-0.5 text-[13px] font-semibold text-brand-700"
                        >
                          Show
                        </button>
                      )}
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                        Each request carries <code>X-QC2GO-Signature</code>, an HMAC-SHA256 of the
                        body with this secret. Verify it before trusting what arrives.
                      </p>
                    </div>

                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => {
                          void setEndpointActive(endpoint.id, !endpoint.active).then(refresh);
                        }}
                      >
                        {endpoint.active ? 'Pause' : 'Resume'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!window.confirm(`Remove ${endpoint.url}?`)) return;
                          void removeEndpoint(endpoint.id).then(refresh);
                        }}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </div>
                  </>
                ) : null}
              </Card>
            ))}
          </div>
        )}

        {deliveries.length > 0 ? (
          <>
            <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
              Recent deliveries
            </h2>
            <Card className="p-2">
              <ul className="flex flex-col divide-y divide-ink-100">
                {deliveries.map((delivery) => (
                  <li key={delivery.id} className="flex items-start gap-2.5 p-2.5">
                    <span
                      className={cx(
                        'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full text-white',
                        delivery.deliveredAt ? 'bg-pass-500' : 'bg-warn-500',
                      )}
                    >
                      {delivery.deliveredAt ? (
                        <CheckIcon className="size-3" strokeWidth={4} />
                      ) : (
                        <AlertIcon className="size-3" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-ink-800">{delivery.event}</p>
                      <p className="text-xs text-ink-500">
                        {delivery.deliveredAt
                          ? `Delivered ${relativeTime(delivery.deliveredAt)}`
                          : `${delivery.attempts} attempt${delivery.attempts === 1 ? '' : 's'} · queued ${relativeTime(delivery.createdAt)}`}
                        {delivery.lastStatus ? ` · HTTP ${delivery.lastStatus}` : ''}
                      </p>
                      {!delivery.deliveredAt && delivery.lastError ? (
                        <p className="mt-0.5 truncate text-xs text-fail-600">{delivery.lastError}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : null}
      </Screen>
    </>
  );
}
