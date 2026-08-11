import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { QUICK_AUDIT_TEMPLATE_ID } from '../templates';
import { todayIso } from '../lib/inspection';
import { capturePosition, customersNear, formatDistance } from '../lib/geo';
import { Button, Card, Field, Screen, TextInput, TopBar, cx, inputClass } from '../components/ui';
import { AlertIcon, MapPinIcon, SearchIcon, UserIcon } from '../components/Icons';

/**
 * A safety audit is often the first thing that happens on arrival, sometimes at a
 * property that is not in the system yet. This screen exists so that starting one
 * never requires setting up a full customer record first.
 */
export function QuickAuditScreen() {
  const navigate = useNavigate();
  const { customers, templates, createCustomer, createInspection } = useStore();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [nearby, setNearby] = useState<Array<{ id: string; miles: number }> | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = templates.find((t) => t.id === QUICK_AUDIT_TEMPLATE_ID && !t.archived);

  const matches = useMemo(() => {
    const active = customers.filter((customer) => !customer.archived);
    const needle = query.trim().toLowerCase();
    if (nearby) {
      const byId = new Map(active.map((c) => [c.id, c]));
      return nearby
        .map((entry) => ({ customer: byId.get(entry.id)!, miles: entry.miles }))
        .filter((entry) => entry.customer);
    }
    if (!needle) {
      return active
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
        .map((customer) => ({ customer, miles: undefined as number | undefined }));
    }
    return active
      .filter((customer) =>
        [customer.customerName, customer.address]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle)),
      )
      .map((customer) => ({ customer, miles: undefined as number | undefined }));
  }, [customers, query, nearby]);

  async function findNearby() {
    setLocating(true);
    setError(null);
    try {
      const position = await capturePosition();
      setNearby(
        customersNear(customers, position, 25).map(({ customer, miles }) => ({
          id: customer.id,
          miles,
        })),
      );
    } catch (locationError) {
      setError(
        locationError instanceof Error ? locationError.message : 'Could not read your location.',
      );
    } finally {
      setLocating(false);
    }
  }

  async function launch(customerId: string) {
    if (!template || busy) return;
    setBusy(true);
    try {
      const inspection = await createInspection(
        customerId,
        template.id,
        'site-visit',
        todayIso(),
      );
      navigate(`/inspections/${inspection.id}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  async function launchNew() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const customer = await createCustomer({
        customerName: newName.trim(),
        address: newAddress.trim(),
        salesperson: '',
        teamLeader: '',
        templateIds: [QUICK_AUDIT_TEMPLATE_ID],
      });
      const inspection = await createInspection(
        customer.id,
        QUICK_AUDIT_TEMPLATE_ID,
        'site-visit',
        todayIso(),
      );
      navigate(`/inspections/${inspection.id}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  if (!template) {
    return (
      <>
        <TopBar title="Quick Safety Audit" back="/" />
        <Screen>
          <Card className="border-warn-200 bg-warn-50 p-4">
            <p className="text-[13px] text-warn-700">
              The Quick Safety Audit checklist has been archived or deleted. An admin can restore
              it under Settings → Checklists.
            </p>
          </Card>
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar title="Quick Safety Audit" subtitle="Pick a customer to start" back="/" />
      <Screen className="pb-10">
        <Card className="border-warn-200 bg-warn-50 p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-warn-700">
            <AlertIcon className="size-4" />
            Fast safety sweep
          </p>
          <p className="mt-1 text-[13px] text-warn-700/90">
            Run on arrival or any time conditions change. Most items are critical — a failure is a
            stop-work condition or something the office needs to hear about today.
          </p>
        </Card>

        <div className="relative mt-4">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setNearby(null);
            }}
            placeholder="Search existing customers…"
            className={cx(inputClass, 'pl-11')}
          />
        </div>

        <Button
          variant="secondary"
          block
          className="mt-2"
          disabled={locating}
          onClick={() => (nearby ? setNearby(null) : void findNearby())}
        >
          <MapPinIcon className="size-5" />
          {locating ? 'Locating…' : nearby ? 'Clear location filter' : 'Find nearest customer'}
        </Button>
        {error ? (
          <p className="mt-2 rounded-xl bg-fail-50 px-3 py-2 text-[13px] text-fail-700">{error}</p>
        ) : null}

        {matches.length > 0 ? (
          <>
            <h2 className="mt-5 mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
              {nearby ? 'Nearest' : query ? 'Matches' : 'Recent'}
            </h2>
            <ul className="flex flex-col gap-2">
              {matches.map(({ customer, miles }) => (
                <Card as="li" key={customer.id} className="active:bg-ink-50">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void launch(customer.id)}
                    className="flex w-full items-center gap-3 p-3.5 text-left disabled:opacity-60"
                  >
                    <UserIcon className="size-5 shrink-0 text-ink-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink-900">
                        {customer.customerName}
                      </span>
                      {customer.address ? (
                        <span className="block truncate text-xs text-ink-500">
                          {customer.address}
                        </span>
                      ) : null}
                    </span>
                    {miles !== undefined ? (
                      <span className="shrink-0 text-xs font-bold text-brand-700">
                        {formatDistance(miles)}
                      </span>
                    ) : null}
                  </button>
                </Card>
              ))}
            </ul>
          </>
        ) : null}

        <h2 className="mt-6 mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Or start at a new address
        </h2>
        <Card className="p-4">
          <div className="flex flex-col gap-3">
            <Field label="Customer name" required>
              <TextInput
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Full name"
              />
            </Field>
            <Field label="Address">
              <TextInput
                value={newAddress}
                onChange={(event) => setNewAddress(event.target.value)}
                placeholder="Street, city, state"
              />
            </Field>
            <Button disabled={busy || !newName.trim()} onClick={() => void launchNew()}>
              <AlertIcon className="size-5" />
              Create and start audit
            </Button>
            <p className="text-xs text-ink-500">
              Creates the customer with just these details. The rest can be filled in later from
              their record.
            </p>
          </div>
        </Card>
      </Screen>
    </>
  );
}
