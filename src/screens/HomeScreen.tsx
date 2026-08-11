import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { resolveChecklist } from '../lib/checklist';
import { overallProgress, relativeTime } from '../lib/inspection';
import { capturePosition, customersNear, formatDistance } from '../lib/geo';
import type { Customer } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Screen,
  TopBar,
  cx,
  inputClass,
} from '../components/ui';
import {
  AlertIcon,
  ChevronRightIcon,
  ClipboardIcon,
  MapPinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from '../components/Icons';

interface Row {
  customer: Customer;
  openDeficiencies: number;
  inProgress: number;
  completed: number;
  lastActivity: string;
  miles?: number;
}

export function HomeScreen() {
  const { customers, inspections, templates, shared, isAdmin } = useStore();
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    return customers
      .filter((customer) => !customer.archived)
      .map((customer) => {
        const mine = inspections.filter((i) => i.customerId === customer.id);
        let openDeficiencies = 0;
        let inProgress = 0;
        let completed = 0;
        for (const inspection of mine) {
          const checklist = resolveChecklist(inspection, templates, shared);
          if (checklist) {
            openDeficiencies += overallProgress(inspection, checklist.sections).failed;
          }
          if (inspection.status === 'completed') completed += 1;
          else inProgress += 1;
        }
        const lastActivity = mine.reduce(
          (latest, i) => (i.updatedAt > latest ? i.updatedAt : latest),
          customer.updatedAt,
        );
        return { customer, openDeficiencies, inProgress, completed, lastActivity };
      })
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }, [customers, inspections, templates, shared]);

  const nearby = useMemo(() => {
    if (!origin) return null;
    const near = customersNear(
      rows.map((row) => row.customer),
      origin,
    );
    const byId = new Map(rows.map((row) => [row.customer.id, row]));
    return near
      .map(({ customer, miles }) => ({ ...byId.get(customer.id)!, miles }))
      .filter(Boolean);
  }, [origin, rows]);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return rows.filter((row) =>
      [
        row.customer.customerName,
        row.customer.address,
        row.customer.salesperson,
        row.customer.teamLeader,
        row.customer.jobNumber,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  async function findNearby() {
    setLocating(true);
    setLocationError(null);
    try {
      const position = await capturePosition();
      setOrigin({ lat: position.lat, lng: position.lng });
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not read your location.');
      setOrigin(null);
    } finally {
      setLocating(false);
    }
  }

  const visible = searched ?? nearby ?? rows;
  const listLabel = searched
    ? `${searched.length} match${searched.length === 1 ? '' : 'es'}`
    : nearby
      ? `${nearby.length} within 25 miles`
      : 'Recent';

  return (
    <>
      <TopBar
        title="QC2GO"
        subtitle="Quality control inspections"
        actions={
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex size-10 items-center justify-center rounded-xl text-white/80 active:bg-white/10"
          >
            <SettingsIcon className="size-5" />
          </Link>
        }
      />

      <Screen className="pb-28">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customer, address, job #…"
            className={cx(inputClass, 'pl-11')}
          />
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Button
            variant={origin ? 'primary' : 'secondary'}
            disabled={locating}
            onClick={() => (origin ? setOrigin(null) : void findNearby())}
          >
            <MapPinIcon className="size-5" />
            {locating ? 'Locating…' : origin ? 'Showing near me' : 'Near me'}
          </Button>
          <Link to="/safety-audit">
            <Button variant="secondary" block className="border-warn-300 text-warn-700">
              <AlertIcon className="size-5" />
              Safety audit
            </Button>
          </Link>
        </div>

        {locationError ? (
          <p className="mt-2 rounded-xl bg-fail-50 px-3 py-2 text-[13px] text-fail-700">
            {locationError}
          </p>
        ) : null}

        {origin && nearby?.length === 0 ? (
          <p className="mt-2 rounded-xl bg-ink-100 px-3 py-2 text-[13px] text-ink-600">
            No customers within 25 miles have a saved location yet. A customer appears here once
            someone taps <strong>Use my location</strong> on their record while on site.
          </p>
        ) : null}

        <div className="mt-5 mb-2.5 flex items-baseline justify-between px-1">
          <h2 className="text-[13px] font-bold tracking-wide text-ink-500 uppercase">
            {listLabel}
          </h2>
          {customers.length > 0 ? (
            <span className="text-xs text-ink-400">{customers.length} total</span>
          ) : null}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="size-10" />}
            title={customers.length === 0 ? 'No customers yet' : 'Nothing matches'}
            description={
              customers.length === 0
                ? 'Add a customer to start running quality control checklists.'
                : 'Try a different search, or add this customer.'
            }
            action={
              <Link to={`/customers/new${query ? `?name=${encodeURIComponent(query)}` : ''}`}>
                <Button>
                  <PlusIcon className="size-5" />
                  {query ? `Add "${query}"` : 'Add first customer'}
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((row) => (
              <CustomerRow key={row.customer.id} row={row} />
            ))}
          </ul>
        )}

        {isAdmin ? (
          <Link
            to="/checklists"
            className="mt-6 flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-3 text-[13px] font-semibold text-ink-700 active:bg-ink-50"
          >
            <SettingsIcon className="size-4 shrink-0 text-ink-400" />
            <span className="flex-1">Manage checklists</span>
            <ChevronRightIcon className="size-4 shrink-0 text-ink-300" />
          </Link>
        ) : null}
      </Screen>

      <div className="safe-pb pointer-events-none fixed inset-x-0 bottom-0 z-30 no-print">
        <div className="mx-auto w-full max-w-3xl px-3 pb-3">
          <Link to="/customers/new" className="pointer-events-auto block">
            <Button block className="shadow-lg shadow-brand-600/25">
              <PlusIcon className="size-5" />
              New customer
            </Button>
          </Link>
        </div>
      </div>
    </>
  );
}

function CustomerRow({ row }: { row: Row }) {
  const { customer, openDeficiencies, inProgress, completed, miles } = row;
  return (
    <Card as="li" className="active:bg-ink-50">
      <Link to={`/customers/${customer.id}`} className="block p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[17px] leading-tight font-bold text-ink-900">
            {customer.customerName}
          </h3>
          <div className="flex shrink-0 items-center gap-1.5">
            {miles !== undefined ? <Badge tone="brand">{formatDistance(miles)}</Badge> : null}
            {openDeficiencies > 0 ? (
              <Badge tone="fail">
                <AlertIcon className="size-3" />
                {openDeficiencies}
              </Badge>
            ) : null}
          </div>
        </div>

        {customer.address ? (
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-600">
            <MapPinIcon className="size-3.5 shrink-0 text-ink-400" />
            <span className="truncate">{customer.address}</span>
          </p>
        ) : null}
        {customer.teamLeader ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-600">
            <UserIcon className="size-3.5 shrink-0 text-ink-400" />
            <span className="truncate">{customer.teamLeader}</span>
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 pt-2.5 text-xs text-ink-500">
          <span className="font-medium">
            {completed === 0 ? 'No QC cards yet' : `${completed} QC card${completed === 1 ? '' : 's'}`}
          </span>
          {inProgress > 0 ? <Badge tone="brand">{inProgress} in progress</Badge> : null}
          <span className="ml-auto">{relativeTime(row.lastActivity)}</span>
        </div>
      </Link>
    </Card>
  );
}
