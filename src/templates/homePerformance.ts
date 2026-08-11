import type { Template } from '../lib/types';

export const homePerformance: Template = {
  id: 'home-performance',
  name: 'Home Performance — Insulation & Air Sealing',
  category: 'home-performance',
  summary: 'Attic, wall, basement and crawlspace air sealing and insulation work.',
  sections: [
    {
      id: 'hp-prep',
      title: 'Preparation & Safety',
      questions: [
        {
          id: 'hp-knob-tube',
          text: 'Knob-and-tube or unsafe wiring identified and cleared before insulating',
          help: 'No insulation buried over active knob-and-tube. Document the electrician sign-off.',
          critical: true,
        },
        {
          id: 'hp-junction-boxes',
          text: 'All junction boxes accessible, covered, and not buried in insulation',
        },
        {
          id: 'hp-can-lights',
          text: 'Recessed lights are IC-rated or fitted with approved airtight covers',
          critical: true,
        },
        {
          id: 'hp-chimney',
          text: 'Chimney and flue chases dammed with fire-rated material and high-temp sealant',
          help: 'Sheet metal plus high-temp caulk, correct clearance to combustibles.',
          critical: true,
        },
        {
          id: 'hp-moisture',
          text: 'No active moisture, mold, or roof leaks in the work area',
          help: 'Insulating over a wet deck buries the problem. Stop and report.',
          critical: true,
        },
        {
          id: 'hp-pre-photos',
          text: 'Pre-existing conditions photographed before work started',
          photoOnPass: true,
        },
      ],
    },
    {
      id: 'hp-air-sealing',
      title: 'Air Sealing',
      description: 'Air sealing is completed and inspected before insulation goes in.',
      questions: [
        {
          id: 'hp-top-plates',
          text: 'Top plates, wire and pipe penetrations sealed at the attic floor',
          photoOnPass: true,
        },
        {
          id: 'hp-chases',
          text: 'Open chases, soffits, and dropped ceilings capped and sealed',
        },
        {
          id: 'hp-attic-hatch',
          text: 'Attic hatch or scuttle insulated, weatherstripped, and dammed',
          photoOnPass: true,
        },
        {
          id: 'hp-rim-joist',
          text: 'Rim / band joist air sealed and insulated to spec',
          photoOnPass: true,
        },
        {
          id: 'hp-duct-sealing',
          text: 'Accessible ductwork sealed with mastic at all joints and boots',
        },
        {
          id: 'hp-bath-fans',
          text: 'Bath and kitchen exhaust fans ducted to the exterior, never into the attic',
          critical: true,
        },
        {
          id: 'hp-basement-sill',
          text: 'Sill plate and foundation-to-framing joint sealed',
        },
      ],
    },
    {
      id: 'hp-insulation',
      title: 'Insulation Installation',
      questions: [
        {
          id: 'hp-r-value',
          text: 'Installed R-value matches the contracted specification',
          critical: true,
        },
        {
          id: 'hp-depth-markers',
          text: 'Depth markers installed and readable; coverage is even with no voids',
          photoOnPass: true,
        },
        {
          id: 'hp-baffles',
          text: 'Baffles installed at every eave; soffit ventilation is not blocked',
          photoOnPass: true,
        },
        {
          id: 'hp-kneewall',
          text: 'Kneewalls insulated and air sealed with rigid backing on the attic side',
        },
        {
          id: 'hp-dense-pack',
          text: 'Dense-pack sidewall cavities filled to target density with no settling voids',
          help: 'Verify by feel and by bag count against square footage.',
        },
        {
          id: 'hp-plugs',
          text: 'Drill holes plugged, patched, and finished to match the existing siding',
          photoOnPass: true,
        },
        {
          id: 'hp-clearances',
          text: 'Required clearances maintained at flues, heat-producing fixtures, and equipment',
          critical: true,
        },
      ],
    },
    {
      id: 'hp-crawl',
      title: 'Crawlspace & Basement',
      questions: [
        {
          id: 'hp-vapor-barrier',
          text: 'Vapor barrier covers full floor, seams overlapped and sealed, run up the walls',
          photoOnPass: true,
        },
        {
          id: 'hp-wall-insulation',
          text: 'Foundation walls insulated per spec with required termite inspection gap',
        },
        {
          id: 'hp-vents',
          text: 'Vents sealed or left open per the design; approach matches the scope',
        },
        {
          id: 'hp-drainage',
          text: 'No standing water; drainage and sump function verified',
          critical: true,
        },
      ],
    },
    {
      id: 'hp-testing',
      title: 'Testing & Verification',
      questions: [
        {
          id: 'hp-blower-door',
          text: 'Post-work blower door test performed and results documented',
          photoOnPass: true,
          critical: true,
        },
        {
          id: 'hp-cfm-pre',
          text: 'Pre-work CFM50',
          kind: 'measurement',
          unit: 'CFM50',
        },
        {
          id: 'hp-cfm-post',
          text: 'Post-work CFM50',
          kind: 'measurement',
          unit: 'CFM50',
        },
        {
          id: 'hp-ach50',
          text: 'Post-work ACH50',
          kind: 'measurement',
          unit: 'ACH50',
        },
        {
          id: 'hp-bpi-safety',
          text: 'Combustion safety test (draft, spillage, ambient CO) passed after air sealing',
          help: 'Worst-case depressurization test on every atmospheric appliance.',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'hp-ambient-co',
          text: 'Highest ambient CO reading',
          kind: 'measurement',
          unit: 'ppm',
        },
        {
          id: 'hp-ventilation-check',
          text: 'Whole-house ventilation still adequate for the tightened envelope',
          help: 'If the house went below the ventilation threshold, mechanical ventilation is required.',
          critical: true,
        },
      ],
    },
  ],
};
