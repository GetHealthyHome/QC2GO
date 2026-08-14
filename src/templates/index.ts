import type { SharedConfig, Template } from '../lib/types';
import { JOB_INFO_FIELDS, UNIVERSAL_SECTION } from './shared';
import { homePerformance } from './homePerformance';
import { indoorAirQuality } from './indoorAirQuality';
import { mitsubishiDucted } from './mitsubishiDucted';
import { mitsubishiDuctless } from './mitsubishiDuctless';
import { quilt } from './quilt';
import { quickSafetyAudit } from './quickSafetyAudit';

export { JOB_INFO_FIELDS, UNIVERSAL_SECTION } from './shared';

/**
 * Shipped checklists. These seed the editable `templates` store on first run —
 * after that the stored copies are the source of truth, so an admin edit sticks.
 * Resetting a checklist restores it from here.
 */
export const BUILT_IN_TEMPLATES: Template[] = [
  quickSafetyAudit,
  homePerformance,
  indoorAirQuality,
  mitsubishiDucted,
  mitsubishiDuctless,
  quilt,
].map((template) => ({ ...template, builtIn: true, version: 1 }));

export function defaultSharedConfig(): SharedConfig {
  return {
    infoFields: JOB_INFO_FIELDS,
    universalSection: UNIVERSAL_SECTION,
    salespeople: [],
    teamLeaders: [],
    // Copied, not shared: this list is editable from Settings, and handing out
    // the module's own array would let one company's edit rewrite the constant.
    // It starts populated where the name lists start empty, because the shipped
    // checklists are already filed under these.
    categories: [...BUILT_IN_CATEGORIES],
    updatedAt: new Date().toISOString(),
  };
}

export const CATEGORY_LABELS: Record<string, string> = {
  'home-performance': 'Home Performance',
  'indoor-air-quality': 'Indoor Air Quality',
  'mitsubishi-ducted': 'Mitsubishi Ducted',
  'mitsubishi-ductless': 'Mitsubishi Ductless',
  quilt: 'Quilt',
  safety: 'Safety',
};

/**
 * The Quick Safety Audit is launched straight from the home screen rather than
 * being attached to a job in advance.
 */
export const QUICK_AUDIT_TEMPLATE_ID = 'quick-safety-audit';

/** Falls back to the raw value so admin-created categories still render. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Sorted the way a person reads them, not the way they are stored. */
function byLabel(a: string, b: string): number {
  return categoryLabel(a).localeCompare(categoryLabel(b));
}

/**
 * Every category the shipped checklists file themselves under.
 *
 * Derived rather than written out again, so a new built-in cannot arrive
 * carrying a category the picker has never heard of. Declared below
 * `CATEGORY_LABELS` because it sorts by label and would otherwise read that
 * const before it is initialized.
 */
export const BUILT_IN_CATEGORIES: string[] = [
  ...new Set(BUILT_IN_TEMPLATES.map((template) => template.category)),
].sort(byLabel);

/**
 * Fill in shared-config fields added after this device last wrote its copy.
 *
 * The shared config is a single stored object rather than a row of columns, so
 * a field added in a later version simply is not there on a device that has not
 * pulled since — and `categories.map(...)` on `undefined` is a blank screen
 * rather than a missing dropdown. Applied wherever the config comes off disk.
 *
 * In memory only. It is written back the first time an admin changes anything,
 * which is soon enough: `categoryOptions` already offers every category in use.
 */
export function normalizeShared(shared: SharedConfig): SharedConfig {
  return Array.isArray(shared.categories)
    ? shared
    : { ...shared, categories: [...BUILT_IN_CATEGORIES] };
}

/**
 * What the category dropdown offers.
 *
 * The admin's list, plus any category a checklist already carries. The second
 * half is what keeps this honest: a company that set up its list before a
 * built-in shipped, or an admin who typed a category back when this was a free
 * text field, would otherwise open a checklist and find its own category
 * missing from the menu — and saving would silently refile it under something
 * else. A category in use stays selectable whether or not anyone listed it.
 */
export function categoryOptions(shared: SharedConfig, templates: Template[]): string[] {
  const options = new Set<string>(shared.categories);
  for (const template of templates) {
    if (template.category.trim().length > 0) options.add(template.category);
  }
  return [...options].sort(byLabel);
}
