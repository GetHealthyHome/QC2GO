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
