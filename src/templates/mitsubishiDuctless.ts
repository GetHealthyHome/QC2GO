import type { Template } from '../lib/types';

export const mitsubishiDuctless: Template = {
  id: 'mitsubishi-ductless',
  name: 'Mitsubishi Ductless Hyper-Heat Heat Pump',
  category: 'mitsubishi-ductless',
  summary: 'Wall-mounted, floor-mounted and ceiling cassette heads, single and multi-zone.',
  sections: [
    {
      id: 'mdl-indoor',
      title: 'Indoor Heads',
      // The section this feature was built for: a job with five heads asks
      // these questions five times, and the answer that matters is which head
      // failed rather than that one of them did.
      repeatable: true,
      instanceNoun: 'Head',
      description: 'Add one for each indoor head on this job, named for where it is.',
      questions: [
        {
          id: 'mdl-model-match',
          text: 'Head models, capacities, and locations match the design and proposal',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-backplate',
          text: 'Mounting plate anchored to studs or solid backing, not drywall anchors alone',
          critical: true,
        },
        {
          id: 'mdl-level',
          text: 'Head is level side to side and pitched per manufacturer for drainage',
          help: 'A head that is out of level will weep condensate down the wall within a season.',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-clearances',
          text: 'Clearance from ceiling, side walls, and furniture meets manufacturer minimums',
        },
        {
          id: 'mdl-placement',
          text: 'Head placement gives good throw into the room and is not blocked by drapes or cabinetry',
        },
        {
          id: 'mdl-aesthetics',
          text: 'Installation is neat and matches what the customer was shown during the sale',
        },
      ],
    },
    {
      id: 'mdl-penetration',
      title: 'Wall Penetration & Condensate',
      questions: [
        {
          id: 'mdl-sleeve',
          text: 'Wall penetration sleeved, sloped down to the exterior, and sealed inside and out',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-no-framing',
          text: 'No structural framing cut or notched without approval',
          critical: true,
        },
        {
          id: 'mdl-drain-slope',
          text: 'Condensate drain has continuous downward slope with no sags, traps, or upward runs',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-drain-test',
          text: 'Every head drain flow tested by pouring water into the pan',
          critical: true,
        },
        {
          id: 'mdl-drain-insulation',
          text: 'Condensate line insulated where it runs through unconditioned or finished space',
        },
        {
          id: 'mdl-pump',
          text: 'Condensate pump (where used) mounted, quiet, and wired to shut the unit down on high level',
          critical: true,
        },
        {
          id: 'mdl-termination',
          text: 'Condensate terminates where it will not stain siding, ice a walkway, or dump on a foundation',
        },
      ],
    },
    {
      id: 'mdl-refrigerant',
      title: 'Line Sets & Refrigerant',
      questions: [
        {
          id: 'mdl-line-length',
          text: 'Total line length and height difference are within limits for this system',
          critical: true,
        },
        {
          id: 'mdl-flares',
          text: 'Flares cut, deburred, and torqued to specification with a torque wrench',
          critical: true,
        },
        {
          id: 'mdl-no-oil',
          text: 'No oil residue or bubbles at any flare or joint after leak check',
          critical: true,
        },
        {
          id: 'mdl-vacuum',
          text: 'Evacuated to 500 microns or below with a documented decay test',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-micron-reading',
          text: 'Final micron reading after decay test',
          kind: 'measurement',
          unit: 'microns',
        },
        {
          id: 'mdl-charge',
          text: 'Additional charge calculated and weighed in where line length requires it',
        },
        {
          id: 'mdl-insulation',
          text: 'Both lines individually insulated end to end with sealed seams',
          photoOnPass: true,
        },
        {
          id: 'mdl-line-hide',
          text: 'Line hide runs straight and level, sealed at penetrations, painted where specified',
          photoOnPass: true,
        },
        {
          id: 'mdl-line-protection',
          text: 'Line set protected from lawn equipment, foot traffic, and snow removal damage',
        },
      ],
    },
    {
      id: 'mdl-multizone',
      title: 'Multi-Zone & Branch Box',
      description: 'Skip with N/A on single-zone systems.',
      questions: [
        {
          id: 'mdl-branch-mount',
          text: 'Branch box mounted level, accessible for service, and in a serviceable location',
        },
        {
          id: 'mdl-branch-drain',
          text: 'Branch box condensate drain installed and tested where the model requires one',
        },
        {
          id: 'mdl-zone-map',
          text: 'Every port labeled with the room it serves and matched to the as-built drawing',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-zone-verify',
          text: 'Zone mapping physically verified by running each head one at a time',
          critical: true,
        },
        {
          id: 'mdl-unused-ports',
          text: 'Unused branch box ports capped and configured per manufacturer',
        },
      ],
    },
    {
      id: 'mdl-outdoor',
      title: 'Outdoor Unit & Electrical',
      questions: [
        {
          id: 'mdl-outdoor-mount',
          text: 'Outdoor unit level and elevated above snow line on pad, stand, or wall bracket',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-outdoor-clearance',
          text: 'Airflow and service clearances met; not boxed in by fencing or plantings',
        },
        {
          id: 'mdl-meltwater',
          text: 'Defrost meltwater drains clear of the unit and any walkway',
          critical: true,
        },
        {
          id: 'mdl-breaker',
          text: 'Breaker and wire sized to the nameplate MCA and MOCP',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-disconnect',
          text: 'Disconnect within sight, labeled, and weatherproof',
          critical: true,
        },
        {
          id: 'mdl-comm-wiring',
          text: 'Control wiring is the specified type, correctly landed per zone, and separated from line voltage',
          critical: true,
        },
        {
          id: 'mdl-grounding',
          text: 'Equipment grounded and bonded per code',
          critical: true,
        },
      ],
    },
    {
      id: 'mdl-startup',
      title: 'Startup & Customer Handoff',
      questions: [
        {
          id: 'mdl-heat-test',
          text: 'Every head run in heating and confirmed delivering warm air',
          critical: true,
        },
        {
          id: 'mdl-cool-test',
          text: 'Every head run in cooling and confirmed delivering cold air',
          critical: true,
        },
        {
          id: 'mdl-delta-t',
          text: 'Delta-T at each head (list per room)',
          kind: 'measurement',
          unit: '°F',
        },
        {
          id: 'mdl-leak-watch',
          text: 'Heads run 15+ minutes in cooling and checked for drips at pan and wall',
          critical: true,
        },
        {
          id: 'mdl-no-codes',
          text: 'No fault codes on any indoor or outdoor unit after full operation',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'mdl-remotes',
          text: 'Remotes or wall controllers paired, batteries installed, and labeled by room',
          photoOnPass: true,
        },
        {
          id: 'mdl-app',
          text: 'Wi-Fi interface commissioned and app access transferred to the customer',
        },
        {
          id: 'mdl-filters',
          text: 'Filters clean and seated; customer shown how to remove and wash them',
        },
        {
          id: 'mdl-usage-coaching',
          text: 'Customer coached on set-and-forget operation and why not to use it like a window unit',
          help: 'Single biggest driver of customer dissatisfaction and high bills on ductless.',
        },
      ],
    },
  ],
};
