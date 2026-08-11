import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCustomer, useStore } from '../lib/store';
import { capturePosition } from '../lib/geo';
import type { Customer, GeoPoint } from '../lib/types';
import { Button, Card, Field, Screen, TextInput, TopBar, cx, inputClass } from '../components/ui';
import { CheckIcon, MapPinIcon } from '../components/Icons';

type Draft = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;

export function CustomerFormScreen() {
  const { customerId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { createCustomer, updateCustomer, shared } = useStore();
  const existing = useCustomer(customerId);
  const editing = Boolean(customerId);

  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? {
          customerName: existing.customerName,
          address: existing.address,
          phone: existing.phone ?? '',
          salesperson: existing.salesperson,
          teamLeader: existing.teamLeader,
          jobNumber: existing.jobNumber ?? '',
          workScope: existing.workScope ?? '',
          templateIds: existing.templateIds ?? [],
          location: existing.location,
        }
      : {
          customerName: searchParams.get('name') ?? '',
          address: '',
          phone: '',
          salesperson: '',
          teamLeader: '',
          jobNumber: '',
          workScope: '',
          templateIds: [],
        },
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const missingName = !draft.customerName.trim();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function useMyLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const point: GeoPoint = await capturePosition();
      set('location', point);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not read your location.');
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    setTouched(true);
    if (missingName || saving) return;
    setSaving(true);
    try {
      if (editing && customerId) {
        await updateCustomer(customerId, draft);
        navigate(`/customers/${customerId}`, { replace: true });
      } else {
        const customer = await createCustomer(draft);
        navigate(`/customers/${customer.id}`, { replace: true });
      }
    } finally {
      setSaving(false);
    }
  }

  if (editing && !existing) {
    return (
      <>
        <TopBar title="Customer not found" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That customer is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={editing ? 'Edit customer' : 'New customer'}
        subtitle={editing ? existing?.customerName : 'Everything hangs off the customer'}
        back={editing && customerId ? `/customers/${customerId}` : '/'}
      />
      <Screen className="pb-28">
        <div className="flex flex-col gap-3.5">
          <Field
            label="Customer name"
            required
            error={touched && missingName ? 'Required' : undefined}
          >
            <TextInput
              value={draft.customerName}
              onChange={(event) => set('customerName', event.target.value)}
              placeholder="Full name"
              autoFocus={!editing}
            />
          </Field>

          <Field label="Job address">
            <TextInput
              value={draft.address}
              onChange={(event) => set('address', event.target.value)}
              placeholder="Street, city, state"
            />
          </Field>

          <Card className="p-3.5">
            <p className="text-[13px] font-semibold text-ink-700">Location</p>
            <p className="mt-0.5 text-xs text-ink-500">
              Saved from this device's GPS so the job shows up under <strong>Near me</strong>.
              Capture it while standing at the property.
            </p>
            {draft.location ? (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-pass-700">
                <CheckIcon className="size-4" strokeWidth={3} />
                Saved
                {draft.location.accuracy
                  ? ` (±${Math.round(draft.location.accuracy)} m)`
                  : ''}
              </p>
            ) : null}
            <Button
              variant="secondary"
              block
              className="mt-2"
              disabled={locating}
              onClick={() => void useMyLocation()}
            >
              <MapPinIcon className="size-5" />
              {locating ? 'Getting GPS fix…' : draft.location ? 'Update location' : 'Use my location'}
            </Button>
            {locationError ? (
              <p className="mt-2 text-xs font-medium text-fail-700">{locationError}</p>
            ) : null}
          </Card>

          <Field label="Customer phone">
            <TextInput
              type="tel"
              value={draft.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="(555) 555-5555"
            />
          </Field>

          <PickList
            label="Salesperson"
            value={draft.salesperson}
            options={shared.salespeople}
            onChange={(value) => set('salesperson', value)}
          />
          <PickList
            label="Team leader"
            value={draft.teamLeader}
            options={shared.teamLeaders}
            onChange={(value) => set('teamLeader', value)}
          />

          <Field label="Job / work order #">
            <TextInput
              value={draft.jobNumber}
              onChange={(event) => set('jobNumber', event.target.value)}
            />
          </Field>

          <Field
            label="Work Scope / Job Notes"
            hint="What was sold, plus access instructions, gate codes, and anything the crew needs."
          >
            <textarea
              rows={4}
              value={draft.workScope}
              onChange={(event) => set('workScope', event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </Screen>

      <div className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur no-print">
        <div className="mx-auto w-full max-w-3xl px-3 py-3">
          <Button block onClick={() => void save()} disabled={saving}>
            {editing ? 'Save changes' : 'Create customer'}
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * Admin-maintained list. Falls back to a free-text field when the list is empty
 * so a new install is usable before anyone has filled it in.
 */
function PickList({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const known = options.length > 0;
  const isOther = known && value !== '' && !options.includes(value);

  if (!known) {
    return (
      <Field
        label={label}
        hint="No list set up yet — an admin can add names under Settings → People."
      >
        <TextInput value={value} onChange={(event) => onChange(event.target.value)} />
      </Field>
    );
  }

  return (
    <Field label={label}>
      <select
        value={isOther ? '__other' : value}
        onChange={(event) =>
          onChange(event.target.value === '__other' ? value || ' ' : event.target.value)
        }
        className={cx(inputClass, 'appearance-none')}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {isOther ? <option value="__other">{value.trim() || 'Other'}</option> : null}
      </select>
    </Field>
  );
}
