import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
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
          Role
        </h2>
        <div className="flex flex-col gap-2">
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
        <p className="mt-2 px-1 text-xs text-ink-500">
          On this device the role only controls which screens are shown. Once accounts are
          connected, the role comes from the signed-in user and is enforced by the server.
        </p>

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
            Jobs, answers, photos, and signatures are stored on this device only. Nothing is
            uploaded.
          </p>
        </Card>
      </Screen>
    </>
  );
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
