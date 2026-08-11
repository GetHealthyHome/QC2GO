import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { CATEGORY_LABELS, TEMPLATES, questionCount } from '../templates';
import { Button, Card, Field, Screen, TextInput, TopBar } from '../components/ui';
import { ClipboardIcon } from '../components/Icons';

export function SettingsScreen() {
  const { settings, saveSettings, jobs, inspections } = useStore();
  const [inspectorName, setInspectorName] = useState(settings.inspectorName);
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setInspectorName(settings.inspectorName);
    setCompanyName(settings.companyName);
  }, [settings]);

  async function save() {
    await saveSettings({ inspectorName: inspectorName.trim(), companyName: companyName.trim() });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  const storageNote =
    'Jobs, answers, photos, and signatures are stored on this device only. Nothing is uploaded.';

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
          Checklists
        </h2>
        <ul className="flex flex-col gap-2">
          {TEMPLATES.map((template) => (
            <Card as="li" key={template.id} className="flex items-center gap-3 p-3.5">
              <ClipboardIcon className="size-5 shrink-0 text-ink-300" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-tight font-semibold text-ink-900">
                  {template.name}
                </p>
                <p className="text-xs text-ink-500">
                  {CATEGORY_LABELS[template.category]} · {questionCount(template)} checkpoints
                </p>
              </div>
            </Card>
          ))}
        </ul>
        <p className="mt-2 px-1 text-xs text-ink-500">
          Every checklist includes the shared Job Information block and the Universal QC Standards
          section.
        </p>

        <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          On this device
        </h2>
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-ink-50 py-3">
              <p className="text-2xl font-bold text-ink-900">{jobs.length}</p>
              <p className="text-xs font-semibold text-ink-500">Jobs</p>
            </div>
            <div className="rounded-xl bg-ink-50 py-3">
              <p className="text-2xl font-bold text-ink-900">{inspections.length}</p>
              <p className="text-xs font-semibold text-ink-500">Inspections</p>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-500">{storageNote}</p>
        </Card>
      </Screen>
    </>
  );
}
