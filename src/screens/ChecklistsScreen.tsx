import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { categoryLabel } from '../templates';
import { questionCount } from '../lib/checklist';
import { relativeTime } from '../lib/inspection';
import type { Template } from '../lib/types';
import { Badge, Button, Card, EmptyState, Screen, TopBar, cx } from '../components/ui';
import { ChevronRightIcon, ClipboardIcon, PlusIcon } from '../components/Icons';

export function ChecklistsScreen() {
  const navigate = useNavigate();
  const { templates, shared, isAdmin } = useStore();
  const [showArchived, setShowArchived] = useState(false);

  const visible = useMemo(
    () =>
      templates
        .filter((template) => (showArchived ? true : !template.archived))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [templates, showArchived],
  );

  const archivedCount = templates.filter((template) => template.archived).length;

  return (
    <>
      <TopBar
        title="Checklists"
        subtitle={isAdmin ? 'Create, edit, and reorder' : 'Read only'}
        back="/settings"
      />
      <Screen className={isAdmin ? 'pb-28' : 'pb-10'}>
        {isAdmin ? (
          <Card className="mb-3 border-brand-200 bg-brand-50 p-4">
            <p className="text-[13px] leading-relaxed text-brand-800">
              Edits apply to inspections started from now on. Inspections already under way or
              signed keep the checklist they captured when they began.
            </p>
          </Card>
        ) : null}

        <Card className="mb-3 active:bg-ink-50">
          <Link to="/checklists/shared" className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Badge tone="brand">Shared by every checklist</Badge>
              <p className="mt-1.5 text-[15px] leading-tight font-bold text-ink-900">
                Job Information &amp; Universal QC Standards
              </p>
              <p className="mt-1 text-[13px] text-ink-500">
                {shared.infoFields.length} header fields ·{' '}
                {shared.universalSection.questions.length} universal checkpoints
              </p>
            </div>
            <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
          </Link>
        </Card>

        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="size-10" />}
            title="No checklists"
            description={
              isAdmin ? 'Create one to get started.' : 'An admin has not published any yet.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((template) => (
              <ChecklistRow
                key={template.id}
                template={template}
                count={questionCount(template, shared)}
              />
            ))}
          </ul>
        )}

        {isAdmin ? (
          <Card className="mt-3 active:bg-ink-50">
            <Link to="/checklists/import" className="flex items-center gap-3 p-4">
              <ClipboardIcon className="size-5 shrink-0 text-ink-300" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink-900">
                  Import, verify &amp; export
                </p>
                <p className="text-xs text-ink-500">
                  Every question as a spreadsheet · verify a file before it changes anything
                </p>
              </div>
              <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
            </Link>
          </Card>
        ) : null}

        {archivedCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowArchived((current) => !current)}
            className="mt-4 w-full py-2 text-[13px] font-semibold text-ink-500"
          >
            {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
          </button>
        ) : null}
      </Screen>

      {isAdmin ? (
        <div className="safe-pb pointer-events-none fixed inset-x-0 bottom-0 z-30 no-print">
          <div className="mx-auto w-full max-w-3xl px-3 pb-3">
            {/*
              Opens the form rather than creating. This used to write an
              "Untitled checklist" the instant it was pressed, before anybody had
              said what they wanted, and backing out left it in the library.
            */}
            <Button
              block
              onClick={() => navigate('/checklists/new')}
              className="pointer-events-auto shadow-lg shadow-brand-600/25"
            >
              <PlusIcon className="size-5" />
              New checklist
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChecklistRow({ template, count }: { template: Template; count: number }) {
  return (
    <Card as="li" className={cx('active:bg-ink-50', template.archived && 'opacity-60')}>
      <Link to={`/checklists/${template.id}`} className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{categoryLabel(template.category)}</Badge>
            {template.builtIn ? <Badge tone="brand">Built in</Badge> : null}
            {template.archived ? <Badge tone="warn">Archived</Badge> : null}
          </div>
          <p className="mt-1.5 text-[15px] leading-tight font-bold text-ink-900">{template.name}</p>
          {template.summary ? (
            <p className="mt-1 text-[13px] leading-snug text-ink-500">{template.summary}</p>
          ) : null}
          <p className="mt-1.5 text-xs font-medium text-ink-400">
            {template.sections.length} section{template.sections.length === 1 ? '' : 's'} ·{' '}
            {count} checkpoints
            {template.updatedAt ? ` · edited ${relativeTime(template.updatedAt)}` : ''}
          </p>
        </div>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
      </Link>
    </Card>
  );
}
