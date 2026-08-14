/**
 * The checklist category, chosen from the list the office maintains.
 *
 * This was a free text field, which is the one thing a category cannot be:
 * grouping checklists on the picker is its whole job, and "Home Performance",
 * "home performance" and "HomePerf" typed by three admins are three groups and
 * one kind of work. So it is a dropdown, and the list behind it belongs to the
 * company rather than to any one checklist — `shared.categories`, edited in
 * Settings beside the salesperson and team-leader lists.
 *
 * ## Why a new one can be added from here
 *
 * Sending an admin to Settings to add "Ventilation" before they can finish the
 * checklist they are in the middle of writing is how a maintained list stops
 * being maintained: the next person picks whichever existing category is
 * closest and the grouping quietly rots. Adding one here writes it to the same
 * shared list Settings edits, so it is on the menu for everyone afterwards —
 * this is a shortcut into the list, not a way around it.
 *
 * The options come from `categoryOptions`, which also includes any category a
 * checklist already carries. An admin opening an older checklist sees its own
 * category selected rather than a blank menu that would refile it on save.
 */
import { useState } from 'react';
import { categoryLabel } from '../templates';
import { Field, TextInput, cx, inputClass } from './ui';

/** Not a category anyone can type: `categoryOptions` only ever yields non-empty. */
const ADD_NEW = '__add_new';

export function CategorySelect({
  value,
  options,
  disabled,
  hint,
  onChange,
  onAddCategory,
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  hint?: string;
  onChange: (category: string) => void;
  /** Adds to the company's list. Omit to offer only what is already there. */
  onAddCategory?: (category: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function commit() {
    const category = draft.trim();
    if (!category) {
      setAdding(false);
      setDraft('');
      return;
    }
    // An existing category typed out by hand selects it rather than listing it
    // twice — the set behind `categoryOptions` would collapse them anyway, but
    // only after a save the admin would have to guess the result of.
    if (!options.includes(category)) onAddCategory?.(category);
    onChange(category);
    setAdding(false);
    setDraft('');
  }

  if (adding) {
    return (
      <Field label="Category" hint="Added to the company's list for everyone.">
        <div className="flex gap-2">
          <TextInput
            autoFocus
            value={draft}
            placeholder="e.g. Ventilation"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
              if (event.key === 'Escape') {
                setAdding(false);
                setDraft('');
              }
            }}
          />
          <button
            type="button"
            onClick={commit}
            disabled={!draft.trim()}
            className="shrink-0 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-white disabled:opacity-50 active:bg-ink-700"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft('');
            }}
            className="shrink-0 rounded-xl border border-ink-200 px-4 text-[13px] font-semibold text-ink-700 active:bg-ink-100"
          >
            Cancel
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Category" hint={hint ?? 'Groups checklists on the picker.'}>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === ADD_NEW) {
            setAdding(true);
            return;
          }
          onChange(event.target.value);
        }}
        className={cx(inputClass, 'appearance-none')}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {categoryLabel(option)}
          </option>
        ))}
        {onAddCategory && !disabled ? <option value={ADD_NEW}>New category…</option> : null}
      </select>
    </Field>
  );
}
