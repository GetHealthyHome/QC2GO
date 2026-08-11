import type { FieldDef, Section } from '../lib/types';

/**
 * The header block every checklist opens with. Values prefill from the job record
 * so the inspector confirms rather than retypes.
 */
export const JOB_INFO_FIELDS: FieldDef[] = [
  { id: 'projectName', label: 'Project name', type: 'text', required: true, fromJob: 'name' },
  {
    id: 'customerName',
    label: 'Customer name',
    type: 'text',
    required: true,
    fromJob: 'customerName',
  },
  { id: 'address', label: 'Job address', type: 'text', required: true, fromJob: 'address' },
  {
    id: 'salesperson',
    label: 'Salesperson',
    type: 'text',
    required: true,
    fromJob: 'salesperson',
    half: true,
  },
  {
    id: 'teamLeader',
    label: 'Team leader',
    type: 'text',
    required: true,
    fromJob: 'teamLeader',
    half: true,
  },
  { id: 'jobNumber', label: 'Job / work order #', type: 'text', fromJob: 'jobNumber', half: true },
  { id: 'permitNumber', label: 'Permit #', type: 'text', half: true },
  { id: 'inspector', label: 'Inspected by', type: 'text', required: true, half: true },
  { id: 'inspectionDate', label: 'Inspection date', type: 'date', required: true, half: true },
  { id: 'crew', label: 'Crew members on site', type: 'text', placeholder: 'Names, comma separated' },
  {
    id: 'customerPresent',
    label: 'Customer present for walkthrough',
    type: 'select',
    required: true,
    options: ['Yes', 'No'],
    half: true,
  },
  { id: 'outdoorTemp', label: 'Outdoor temp (°F)', type: 'number', half: true },
  {
    id: 'utilityProgram',
    label: 'Utility / rebate program',
    type: 'text',
    placeholder: 'e.g. Mass Save, none',
  },
];

/**
 * Asked on every inspection regardless of the system installed — workmanship,
 * documentation, and customer handoff standards that apply company-wide.
 */
export const UNIVERSAL_SECTION: Section = {
  id: 'universal',
  title: 'Universal QC Standards',
  description: 'Applies to every job, every visit type.',
  questions: [
    {
      id: 'u-scope',
      text: 'Installed work matches the signed scope of work / proposal',
      help: 'Compare equipment, quantities, and locations against the sold proposal line by line.',
      critical: true,
    },
    {
      id: 'u-change-orders',
      text: 'Any deviations from scope are documented on a signed change order',
      help: 'Verbal approvals do not count. If the crew changed anything, there is paperwork.',
      critical: true,
    },
    {
      id: 'u-permits',
      text: 'Permits pulled, posted on site, and required inspections scheduled or passed',
    },
    {
      id: 'u-serials',
      text: 'All equipment model and serial numbers recorded and photographed',
      help: 'Shoot the data plate straight on and legible — this is the warranty record.',
      photoOnPass: true,
    },
    {
      id: 'u-registration',
      text: 'Manufacturer warranty registration submitted',
      help: 'Extended warranties are void if registration is missed inside the window.',
    },
    {
      id: 'u-protection',
      text: 'Floor and surface protection was used; no damage to interior finishes',
    },
    {
      id: 'u-cleanup',
      text: 'Work areas cleaned; all debris, packaging, and old equipment removed from property',
      photoOnPass: true,
    },
    {
      id: 'u-exterior',
      text: 'No damage to siding, roofing, landscaping, or driveway',
    },
    {
      id: 'u-penetrations',
      text: 'All exterior penetrations sealed, flashed, and weather-tight',
      help: 'Check every hole made today: line sets, vents, condensate, wiring.',
      photoOnPass: true,
    },
    {
      id: 'u-labeling',
      text: 'Equipment, disconnects, and breakers are labeled and accessible',
    },
    {
      id: 'u-co-alarms',
      text: 'Working CO and smoke alarms present on every level with combustion appliances',
      critical: true,
    },
    {
      id: 'u-combustion',
      text: 'Existing combustion appliances checked for proper draft and no spillage',
      help: 'Required any time the building envelope or air balance was changed.',
      critical: true,
    },
    {
      id: 'u-operation',
      text: 'System started, run through a full cycle, and left operating correctly',
      critical: true,
    },
    {
      id: 'u-walkthrough',
      text: 'Customer walkthrough completed and system operation demonstrated',
    },
    {
      id: 'u-education',
      text: 'Customer trained on controls, filter service intervals, and seasonal changeover',
    },
    {
      id: 'u-documents',
      text: 'Manuals, warranty paperwork, and spare filters left with customer',
    },
    {
      id: 'u-service-contact',
      text: 'Customer given service contact information and knows who to call',
    },
    {
      id: 'u-satisfaction',
      text: 'Customer states they are satisfied with the completed work',
      help: 'If No, capture their words verbatim in the explanation.',
      critical: true,
    },
  ],
};
