import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useJob, useStore } from '../lib/store';
import type { Job } from '../lib/types';
import { Button, Field, Screen, TextInput, TopBar, inputClass } from '../components/ui';

type Draft = Omit<Job, 'id' | 'createdAt' | 'updatedAt'>;

const EMPTY: Draft = {
  name: '',
  customerName: '',
  address: '',
  salesperson: '',
  teamLeader: '',
  phone: '',
  jobNumber: '',
  notes: '',
};

export function JobFormScreen() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { createJob, updateJob } = useStore();
  const existing = useJob(jobId);
  const editing = Boolean(jobId);

  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? {
          name: existing.name,
          customerName: existing.customerName,
          address: existing.address,
          salesperson: existing.salesperson,
          teamLeader: existing.teamLeader,
          phone: existing.phone ?? '',
          jobNumber: existing.jobNumber ?? '',
          notes: existing.notes ?? '',
        }
      : EMPTY,
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const missing = {
    name: !draft.name.trim(),
    customerName: !draft.customerName.trim(),
  };
  const valid = !missing.name && !missing.customerName;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (editing && jobId) {
        await updateJob(jobId, draft);
        navigate(`/jobs/${jobId}`, { replace: true });
      } else {
        const job = await createJob(draft);
        navigate(`/jobs/${job.id}`, { replace: true });
      }
    } finally {
      setSaving(false);
    }
  }

  if (editing && !existing) {
    return (
      <>
        <TopBar title="Job not found" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That job is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={editing ? 'Edit job' : 'New job'}
        subtitle={editing ? existing?.name : 'Jobs organize every checklist'}
        back={editing && jobId ? `/jobs/${jobId}` : '/'}
      />
      <Screen className="pb-28">
        <div className="flex flex-col gap-3.5">
          <Field label="Job name" required error={touched && missing.name ? 'Required' : undefined}>
            <TextInput
              value={draft.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="e.g. Holcombe — Whole Home Retrofit"
              autoFocus={!editing}
            />
          </Field>

          <Field
            label="Customer name"
            required
            error={touched && missing.customerName ? 'Required' : undefined}
          >
            <TextInput
              value={draft.customerName}
              onChange={(event) => set('customerName', event.target.value)}
              placeholder="Full name"
            />
          </Field>

          <Field label="Job address">
            <TextInput
              value={draft.address}
              onChange={(event) => set('address', event.target.value)}
              placeholder="Street, city, state"
            />
          </Field>

          <Field label="Customer phone">
            <TextInput
              type="tel"
              value={draft.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="(555) 555-5555"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Salesperson">
              <TextInput
                value={draft.salesperson}
                onChange={(event) => set('salesperson', event.target.value)}
              />
            </Field>
            <Field label="Team leader">
              <TextInput
                value={draft.teamLeader}
                onChange={(event) => set('teamLeader', event.target.value)}
              />
            </Field>
          </div>

          <Field label="Job / work order #">
            <TextInput
              value={draft.jobNumber}
              onChange={(event) => set('jobNumber', event.target.value)}
            />
          </Field>

          <Field label="Job notes" hint="Scope reminders, access instructions, gate codes.">
            <textarea
              rows={3}
              value={draft.notes}
              onChange={(event) => set('notes', event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </Screen>

      <div className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur no-print">
        <div className="mx-auto w-full max-w-3xl px-3 py-3">
          <Button block onClick={() => void save()} disabled={saving}>
            {editing ? 'Save changes' : 'Create job'}
          </Button>
        </div>
      </div>
    </>
  );
}
