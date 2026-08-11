import type { Template } from '../lib/types';

/**
 * Short by design. This is run in a few minutes on arrival, or any time
 * something looks wrong — not a full inspection. Anything here that fails is
 * either a stop-work condition or something the office needs to know about
 * today, which is why almost every item is critical.
 */
export const quickSafetyAudit: Template = {
  id: 'quick-safety-audit',
  name: 'Quick Safety Audit',
  category: 'safety',
  summary: 'Fast on-site safety sweep. Run on arrival or any time conditions change.',
  sections: [
    {
      id: 'qsa-occupant',
      title: 'Occupant & Building Safety',
      description: 'Hazards to the people living here.',
      questions: [
        {
          id: 'qsa-co-alarms',
          text: 'Working CO alarms present on every level with fuel-burning appliances',
          help: 'Press to test. A missing or dead CO alarm is a same-day fix, not a punch item.',
          critical: true,
        },
        {
          id: 'qsa-smoke-alarms',
          text: 'Working smoke alarms present and not past their replacement date',
          critical: true,
        },
        {
          id: 'qsa-gas-odor',
          text: 'No gas odor anywhere in the building',
          help: 'If yes to an odor: stop, evacuate, call the utility. Do not continue the audit.',
          critical: true,
        },
        {
          id: 'qsa-co-reading',
          text: 'Ambient CO reading in the main living space',
          kind: 'measurement',
          unit: 'ppm',
        },
        {
          id: 'qsa-spillage',
          text: 'No visible spillage, scorching, or backdraft at any combustion appliance',
          help: 'Look for soot, melted plastic, or rust streaks at the draft hood.',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'qsa-flue',
          text: 'Flues and vent connectors intact, sloped correctly, and properly supported',
          critical: true,
        },
        {
          id: 'qsa-chemicals',
          text: 'No solvents, gasoline, or paint stored near combustion appliances',
        },
        {
          id: 'qsa-egress',
          text: 'Exits, stairs, and walkways clear of tools, materials, and cords',
          critical: true,
        },
      ],
    },
    {
      id: 'qsa-electrical',
      title: 'Electrical',
      questions: [
        {
          id: 'qsa-panel',
          text: 'Panel cover in place, no exposed conductors or open knockouts',
          critical: true,
        },
        {
          id: 'qsa-wiring',
          text: 'No damaged, spliced, or unsupported wiring in the work area',
          critical: true,
        },
        {
          id: 'qsa-knob-tube',
          text: 'Knob-and-tube or other legacy wiring identified and flagged if present',
          help: 'Answer No if it is present and not yet documented for the office.',
        },
        {
          id: 'qsa-gfci',
          text: 'GFCI protection present where required and tested',
        },
        {
          id: 'qsa-cords',
          text: 'Extension cords and power tools in good condition, correctly rated',
        },
      ],
    },
    {
      id: 'qsa-materials',
      title: 'Hazardous Materials & Air Quality',
      description: 'Suspect it, stop and report it — do not disturb.',
      questions: [
        {
          id: 'qsa-asbestos',
          text: 'No suspected asbestos disturbed or at risk of disturbance',
          help: 'Pipe wrap, duct tape mastic, floor tile, popcorn ceilings in pre-1985 homes.',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'qsa-vermiculite',
          text: 'No vermiculite insulation present in the work area',
          help: 'Loose, pebbly, gold-brown. Assume it contains asbestos until tested.',
          critical: true,
        },
        {
          id: 'qsa-lead',
          text: 'Lead-safe practices in place where pre-1978 painted surfaces are disturbed',
          critical: true,
        },
        {
          id: 'qsa-mold',
          text: 'No active mold growth or water intrusion in the work area',
          photoOnPass: true,
        },
        {
          id: 'qsa-pests',
          text: 'No rodent or pest contamination requiring remediation before work',
        },
      ],
    },
    {
      id: 'qsa-worksite',
      title: 'Crew & Work Area',
      questions: [
        {
          id: 'qsa-ppe',
          text: 'Crew wearing the PPE the task requires',
          help: 'Respirators for insulation and demo, eye protection, gloves, hearing protection.',
          critical: true,
        },
        {
          id: 'qsa-ladders',
          text: 'Ladders correctly set, footed, and tied off where required',
          critical: true,
        },
        {
          id: 'qsa-fall',
          text: 'Fall protection in place for attic walkways, roof work, and open framing',
          critical: true,
        },
        {
          id: 'qsa-attic-access',
          text: 'Attic and crawlspace access safe — adequate lighting, no unsupported ceiling',
        },
        {
          id: 'qsa-structural',
          text: 'No structural concerns noted in attic, crawlspace, or basement',
          photoOnPass: true,
        },
        {
          id: 'qsa-vehicles',
          text: 'Vehicles and trailers parked without blocking access or creating a hazard',
        },
        {
          id: 'qsa-occupants',
          text: 'Occupants, children, and pets kept clear of the work area',
        },
      ],
    },
  ],
};
