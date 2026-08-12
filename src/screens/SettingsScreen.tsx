import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { retryRejected, runSync, type SyncStatus } from '../lib/sync';
import type { Role } from '../lib/types';
import { Badge, Button, Card, Field, Screen, TextInput, TopBar, cx } from '../components/ui';
import {
  ChevronRightIcon,
  ClipboardIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  UserIcon,
} from '../components/Icons';

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  inspector: 'Inspector',
};

/**
 * The two roles a device can claim for itself with no backend. Owner is not
 * here on purpose: it only ever arrives from a signed-in profile, because the
 * rights it carries are over other people's accounts.
 */
const ROLES: Array<{ id: Role; label: string; description: string }> = [
  {
    id: 'inspector',
    label: 'Inspector',
    description: 'Runs inspections and reads past reports.',
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Also builds and edits checklists for the whole organization.',
  },
];

export function SettingsScreen() {
  const { settings, saveSettings, saveShared, customers, inspections, templates, shared, isAdmin } =
    useStore();
  const auth = useAuth();
  const [inspectorName, setInspectorName] = useState(settings.inspectorName);
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setInspectorName(settings.inspectorName);
    setCompanyName(settings.companyName);
  }, [settings]);

  async function save() {
    await saveSettings({
      ...settings,
      inspectorName: inspectorName.trim(),
      companyName: companyName.trim(),
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      <TopBar title="Settings" back="/" />
      <Screen className="pb-10">
        <div className="flex flex-col gap-3.5">
          <Field label="Your name" hint="Prefills the inspector field on new inspections.">
            <TextInput
              value={inspectorName}
              onChange={(event) => setInspectorName(event.target.value)}
              placeholder="Inspector name"
            />
          </Field>
          <Field label="Company name" hint="Shown as the header on printed reports.">
            <TextInput
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Company name"
            />
          </Field>
          <Button onClick={() => void save()}>{saved ? 'Saved' : 'Save'}</Button>
        </div>

        <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          {auth.enabled ? 'Account' : 'Role'}
        </h2>

        {auth.enabled ? (
          <Card className="p-4">
            <p className="text-[15px] font-semibold text-ink-900">
              {auth.profile?.fullName || auth.profile?.email || 'Signed in'}
            </p>
            {auth.profile?.fullName && auth.profile.email ? (
              <p className="text-[13px] text-ink-500">{auth.profile.email}</p>
            ) : null}
            <Badge tone={isAdmin ? 'brand' : 'neutral'} className="mt-2">
              {ROLE_LABELS[auth.profile?.role ?? 'inspector']}
            </Badge>
            {auth.profile?.organization ? (
              <p className="mt-2 text-[13px] text-ink-600">
                <span className="text-ink-500">Company: </span>
                <span className="font-semibold text-ink-900">
                  {auth.profile.organization.name}
                </span>
              </p>
            ) : null}
            <p className="mt-2 text-xs text-ink-500">
              Your company and your role are set on your account. Neither can be changed from
              this device — everything you can see and save is decided by the server.
            </p>
            <Button
              variant="secondary"
              block
              className="mt-3"
              onClick={() => void auth.signOut()}
            >
              Sign out
            </Button>
          </Card>
        ) : null}

        <div className={cx('flex flex-col gap-2', auth.enabled && 'hidden')}>
          {ROLES.map((role) => (
            <button
              key={role.id}
              type="button"
              aria-pressed={settings.role === role.id}
              onClick={() => void saveSettings({ ...settings, role: role.id })}
              className={cx(
                'flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors',
                settings.role === role.id
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-ink-200 bg-white active:bg-ink-50',
              )}
            >
              {role.id === 'admin' ? (
                <SettingsIcon className="size-5 shrink-0 text-ink-400" />
              ) : (
                <UserIcon className="size-5 shrink-0 text-ink-400" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cx(
                    'text-[15px] font-bold',
                    settings.role === role.id ? 'text-brand-800' : 'text-ink-900',
                  )}
                >
                  {role.label}
                </p>
                <p className="text-[13px] text-ink-500">{role.description}</p>
              </div>
            </button>
          ))}
        </div>
        {!auth.enabled ? (
          <p className="mt-2 px-1 text-xs text-ink-500">
            No backend is configured, so this only controls which screens are shown. With
            accounts connected, the role comes from the signed-in user and is enforced by the
            server.
          </p>
        ) : null}

        {isAdmin ? (
          <>
            <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
              People
            </h2>
            <p className="mb-2.5 px-1 text-[13px] text-ink-500">
              These become the Salesperson and Team Leader dropdowns on every customer, so field
              staff pick a name instead of typing one.
            </p>
            <div className="flex flex-col gap-2.5">
              <NameList
                label="Salespeople"
                names={shared.salespeople}
                onChange={(salespeople) => void saveShared({ ...shared, salespeople })}
              />
              <NameList
                label="Team leaders"
                names={shared.teamLeaders}
                onChange={(teamLeaders) => void saveShared({ ...shared, teamLeaders })}
              />
            </div>
          </>
        ) : null}

        <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Checklists
        </h2>
        <Card className="active:bg-ink-50">
          <Link to="/checklists" className="flex items-center gap-3 p-4">
            <ClipboardIcon className="size-5 shrink-0 text-ink-300" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink-900">
                {settings.role === 'admin' ? 'Manage checklists' : 'View checklists'}
              </p>
              <p className="text-xs text-ink-500">
                {templates.filter((template) => !template.archived).length} active
                {settings.role === 'admin' ? ' · create, edit, and reorder' : ''}
              </p>
            </div>
            {settings.role === 'admin' ? <Badge tone="brand">Admin</Badge> : null}
            <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
          </Link>
        </Card>

        <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          On this device
        </h2>
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-ink-50 py-3">
              <p className="text-2xl font-bold text-ink-900">{customers.length}</p>
              <p className="text-xs font-semibold text-ink-500">Customers</p>
            </div>
            <div className="rounded-xl bg-ink-50 py-3">
              <p className="text-2xl font-bold text-ink-900">{inspections.length}</p>
              <p className="text-xs font-semibold text-ink-500">Inspections</p>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-500">
            {auth.enabled
              ? 'Everything saves to this device first and uploads in the background, so a walkthrough never waits on a signal.'
              : 'Jobs, answers, photos, and signatures are stored on this device only. Nothing is uploaded.'}
          </p>
        </Card>

        {auth.enabled ? <SyncCard /> : null}
      </Screen>
    </>
  );
}

/**
 * The honest answer to "is my work safe?". Inspectors finish a job in a basement
 * and drive away; this is where they can see whether it actually went up.
 */
function SyncCard() {
  const { sync } = useStore();
  const [retrying, setRetrying] = useState(false);

  const summary = describeSync(sync);

  async function retry() {
    setRetrying(true);
    try {
      await retryRejected();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
        Sync
      </h2>
      <Card className="p-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cx(
              'size-2.5 shrink-0 rounded-full',
              summary.tone === 'ok' && 'bg-pass-500',
              summary.tone === 'busy' && 'animate-pulse bg-brand-500',
              summary.tone === 'warn' && 'bg-warn-500',
              summary.tone === 'bad' && 'bg-fail-500',
            )}
          />
          <p className="min-w-0 flex-1 text-[15px] font-semibold text-ink-900">{summary.label}</p>
          <Button
            variant="secondary"
            className="shrink-0 px-3 py-1.5 text-[13px]"
            onClick={() => void runSync()}
            disabled={sync.phase === 'syncing'}
          >
            Sync now
          </Button>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">{summary.detail}</p>

        {sync.rejected > 0 ? (
          <div className="mt-3 rounded-xl bg-fail-50 p-3">
            <p className="text-[13px] font-semibold text-fail-700">
              {sync.rejected} {sync.rejected === 1 ? 'change was' : 'changes were'} refused by the
              server
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fail-700/80">
              Usually this means the record is no longer yours to edit — a signed inspection can
              only be reopened by an admin. The change is still on this device.
            </p>
            <Button
              variant="secondary"
              block
              className="mt-2.5"
              onClick={() => void retry()}
              disabled={retrying}
            >
              {retrying ? 'Trying again…' : 'Try again'}
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}

function describeSync(sync: SyncStatus): {
  label: string;
  detail: string;
  tone: 'ok' | 'busy' | 'warn' | 'bad';
} {
  const last = sync.lastSyncedAt
    ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}.`
    : 'Not synced yet on this device.';

  if (sync.phase === 'syncing') {
    return { label: 'Syncing…', detail: last, tone: 'busy' };
  }
  if (sync.phase === 'offline') {
    return {
      label: 'Offline',
      detail: `${sync.pending} ${sync.pending === 1 ? 'change is' : 'changes are'} waiting to upload. ${last}`,
      tone: 'warn',
    };
  }
  if (sync.phase === 'error') {
    return { label: 'Could not reach the server', detail: sync.error ?? last, tone: 'bad' };
  }
  if (sync.pending > 0) {
    return {
      label: `${sync.pending} waiting to upload`,
      detail: last,
      tone: 'warn',
    };
  }
  return { label: 'Up to date', detail: last, tone: 'ok' };
}

/** Admin-maintained pick list. Names are plain strings — no separate person record. */
function NameList({
  label,
  names,
  onChange,
}: {
  label: string;
  names: string[];
  onChange: (names: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const name = draft.trim();
    if (!name || names.includes(name)) {
      setDraft('');
      return;
    }
    onChange([...names, name].sort((a, b) => a.localeCompare(b)));
    setDraft('');
  }

  return (
    <Card className="p-4">
      <p className="text-[13px] font-semibold text-ink-700">{label}</p>
      {names.length === 0 ? (
        <p className="mt-1 text-xs text-ink-500">
          None yet — until one is added, this field stays free text on the customer form.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {names.map((name) => (
            <li
              key={name}
              className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-[14px] text-ink-800"
            >
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(names.filter((candidate) => candidate !== name))}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fail-600 active:bg-fail-50"
              >
                <TrashIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex gap-2">
        <TextInput
          value={draft}
          placeholder="Add a name"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" className="shrink-0 px-4" onClick={add} disabled={!draft.trim()}>
          <PlusIcon className="size-5" />
        </Button>
      </div>
    </Card>
  );
}
