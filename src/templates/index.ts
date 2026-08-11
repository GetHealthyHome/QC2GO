import type { Section, Template, TemplateCategory } from '../lib/types';
import { UNIVERSAL_SECTION } from './shared';
import { homePerformance } from './homePerformance';
import { indoorAirQuality } from './indoorAirQuality';
import { mitsubishiDucted } from './mitsubishiDucted';
import { mitsubishiDuctless } from './mitsubishiDuctless';
import { quilt } from './quilt';

export { JOB_INFO_FIELDS, UNIVERSAL_SECTION } from './shared';

export const TEMPLATES: Template[] = [
  homePerformance,
  indoorAirQuality,
  mitsubishiDucted,
  mitsubishiDuctless,
  quilt,
];

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  'home-performance': 'Home Performance',
  'indoor-air-quality': 'Indoor Air Quality',
  'mitsubishi-ducted': 'Mitsubishi Ducted',
  'mitsubishi-ductless': 'Mitsubishi Ductless',
  quilt: 'Quilt',
};

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/**
 * The sections an inspection actually runs: the universal block first, then the
 * system-specific work. Keeping the shared section in one place means adding a
 * company-wide standard updates every checklist at once.
 */
export function sectionsFor(template: Template): Section[] {
  return [UNIVERSAL_SECTION, ...template.sections];
}

export function questionCount(template: Template): number {
  return sectionsFor(template).reduce((total, section) => total + section.questions.length, 0);
}
