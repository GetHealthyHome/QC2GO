import type { Template } from '../lib/types';

export const mitsubishiDucted: Template = {
  id: 'mitsubishi-ducted',
  name: 'Mitsubishi Ducted Hyper-Heat Heat Pump',
  category: 'mitsubishi-ducted',
  summary: 'Ducted air handlers and horizontal-ducted indoor units on hyper-heating outdoor units.',
  sections: [
    {
      id: 'md-outdoor',
      title: 'Outdoor Unit',
      questions: [
        {
          id: 'md-model-match',
          text: 'Outdoor unit model matches the Manual J load calculation and the sold proposal',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'md-pad',
          text: 'Unit level on a solid pad or wall bracket, elevated above expected snow depth',
          help: 'Hyper-heat units run in deep winter — base must stay clear of drifting and meltwater.',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'md-clearances',
          text: 'Manufacturer service and airflow clearances met on all sides and above',
        },
        {
          id: 'md-isolation',
          text: 'Vibration isolation pads installed; unit secured against wind, seismic, or snow load as required',
        },
        {
          id: 'md-drainage',
          text: 'Defrost meltwater drains away freely and will not ice under the unit or on a walkway',
          critical: true,
        },
        {
          id: 'md-pan-heater',
          text: 'Base pan heater installed and wired where the application requires it',
        },
        {
          id: 'md-roof-drip',
          text: 'Unit not located under a roof drip line or icicle fall path',
        },
      ],
    },
    {
      id: 'md-refrigerant',
      title: 'Line Set & Refrigerant',
      questions: [
        {
          id: 'md-line-size',
          text: 'Line set diameter and total length are within manufacturer limits for this pairing',
          critical: true,
        },
        {
          id: 'md-nitrogen',
          text: 'Nitrogen purge used during all brazing',
          critical: true,
        },
        {
          id: 'md-flares',
          text: 'Flares cut, deburred, and torqued to Mitsubishi specification with a torque wrench',
          help: 'No over-tightening. Torque values are per line size in the install manual.',
          critical: true,
        },
        {
          id: 'md-pressure-test',
          text: 'Pressure test held at specified pressure with no loss',
          photoOnPass: true,
          critical: true,
        },
        {
          id: 'md-vacuum',
          text: 'Evacuated to 500 microns or below with a documented decay test',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'md-micron-reading',
          text: 'Final micron reading after decay test',
          kind: 'measurement',
          unit: 'microns',
        },
        {
          id: 'md-charge',
          text: 'Additional refrigerant charge calculated for line length, weighed in, and recorded',
          critical: true,
        },
        {
          id: 'md-charge-amount',
          text: 'Additional charge added',
          kind: 'measurement',
          unit: 'oz',
        },
        {
          id: 'md-insulation',
          text: 'Both lines fully insulated with no gaps at fittings; outdoor insulation UV protected',
          photoOnPass: true,
        },
        {
          id: 'md-line-support',
          text: 'Line set supported, protected where it passes through framing, and free of kinks',
        },
        {
          id: 'md-line-hide',
          text: 'Exterior line hide installed neatly, sealed at the wall, and pitched to shed water',
          photoOnPass: true,
        },
      ],
    },
    {
      id: 'md-electrical',
      title: 'Electrical & Controls',
      questions: [
        {
          id: 'md-breaker',
          text: 'Breaker size and wire gauge match the equipment nameplate MCA and MOCP',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'md-disconnect',
          text: 'Disconnect installed within sight of the unit and properly labeled',
          critical: true,
        },
        {
          id: 'md-whip',
          text: 'Whip and conduit secured, weatherproof, with correct fittings and drip loops',
        },
        {
          id: 'md-grounding',
          text: 'Equipment grounded and bonded per code',
          critical: true,
        },
        {
          id: 'md-comm-wiring',
          text: 'Communication wiring is the specified type and is not run in the same conduit as line voltage',
          help: 'Mixing control and line voltage is the number one cause of nuisance comm errors.',
          critical: true,
        },
        {
          id: 'md-terminations',
          text: 'All terminations tight, correctly landed, and torqued; no exposed conductors',
        },
        {
          id: 'md-controller',
          text: 'Thermostat or wall controller mounted at proper height, away from drafts and heat sources',
        },
        {
          id: 'md-kumo',
          text: 'Interface commissioned, connected to Wi-Fi, and app access handed to the customer',
          photoOnPass: true,
        },
        {
          id: 'md-dip-switches',
          text: 'Dip switches and configuration settings set for this installation, not left at factory default',
          critical: true,
          photoOnPass: true,
        },
      ],
    },
    {
      id: 'md-airhandler',
      title: 'Air Handler & Distribution',
      questions: [
        {
          id: 'md-ah-mount',
          text: 'Air handler mounted level, isolated from structure, with full service access',
        },
        {
          id: 'md-plenums',
          text: 'Supply and return plenums sealed airtight to the cabinet',
          photoOnPass: true,
        },
        {
          id: 'md-duct-sealing',
          text: 'All duct joints mechanically fastened and sealed with mastic',
        },
        {
          id: 'md-duct-insulation',
          text: 'Ducts in unconditioned space insulated to spec with sealed vapor barrier',
        },
        {
          id: 'md-filter-rack',
          text: 'Filter rack accessible, gasketed, and filter size labeled',
          photoOnPass: true,
        },
        {
          id: 'md-static',
          text: 'Total external static pressure measured and within the blower table limits',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'md-tesp',
          text: 'Total external static pressure',
          kind: 'measurement',
          unit: 'in. w.c.',
        },
        {
          id: 'md-airflow',
          text: 'Delivered airflow verified against design CFM; blower speed set accordingly',
          critical: true,
        },
        {
          id: 'md-registers',
          text: 'Registers and grilles installed, balanced, and every room gets measurable airflow',
        },
        {
          id: 'md-condensate',
          text: 'Primary drain trapped and sloped; secondary drain or float safety switch installed and tested',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'md-condensate-test',
          text: 'Condensate system flow tested with water and safety switch proven to shut the unit down',
          critical: true,
        },
      ],
    },
    {
      id: 'md-startup',
      title: 'Startup & Performance',
      questions: [
        {
          id: 'md-heat-mode',
          text: 'System run in heating; discharge air temperature and operation verified',
          critical: true,
        },
        {
          id: 'md-cool-mode',
          text: 'System run in cooling; discharge air temperature and operation verified',
          critical: true,
        },
        {
          id: 'md-delta-t',
          text: 'Supply / return delta-T',
          kind: 'measurement',
          unit: '°F',
        },
        {
          id: 'md-no-codes',
          text: 'No fault codes present after a full run in both modes',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'md-defrost',
          text: 'Defrost operation explained to the customer so steam and noise are not alarming',
        },
        {
          id: 'md-noise',
          text: 'Indoor and outdoor noise levels acceptable; no rattles, buzzing, or resonance',
        },
        {
          id: 'md-backup-heat',
          text: 'Backup or auxiliary heat lockout and staging configured correctly',
          help: 'A hyper-heat system that leans on strip heat at 35°F will destroy the operating cost promise.',
          critical: true,
        },
        {
          id: 'md-startup-sheet',
          text: 'Startup report completed, signed, and filed with the job',
          photoOnPass: true,
        },
      ],
    },
  ],
};
