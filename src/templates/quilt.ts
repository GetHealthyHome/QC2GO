import type { Template } from '../lib/types';

export const quilt: Template = {
  id: 'quilt',
  name: 'Quilt Ductless Heat Pump',
  category: 'quilt',
  summary: 'Quilt indoor Covers, Dial controllers, outdoor unit and app commissioning.',
  sections: [
    {
      id: 'q-design',
      title: 'System Design Verification',
      questions: [
        {
          id: 'q-config',
          text: 'Installed configuration matches the approved Quilt system design and proposal',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-zone-count',
          text: 'Correct number of indoor Covers installed in the correct rooms',
          critical: true,
        },
        {
          id: 'q-capacity',
          text: 'Capacity matches the room-by-room load calculation',
          critical: true,
        },
        {
          id: 'q-serials',
          text: 'Serial numbers of the outdoor unit, each Cover, and each Dial recorded',
          photoOnPass: true,
        },
      ],
    },
    {
      id: 'q-covers',
      title: 'Indoor Covers',
      questions: [
        {
          id: 'q-cover-mount',
          text: 'Mounting bracket anchored into studs or approved solid backing',
          critical: true,
        },
        {
          id: 'q-cover-level',
          text: 'Cover is level and set at the manufacturer-specified height and clearances',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-cover-clearance',
          text: 'Clearance to ceiling, corners, and furnishings meets Quilt requirements',
        },
        {
          id: 'q-cover-airflow',
          text: 'Airflow path into the room is unobstructed by drapery, shelving, or trim',
        },
        {
          id: 'q-cover-finish',
          text: 'Cover seated fully with no gaps, scuffs, protective film removed, and wall finish undamaged',
          photoOnPass: true,
        },
        {
          id: 'q-cover-placement-approved',
          text: 'Final placement was confirmed with the customer before drilling',
        },
      ],
    },
    {
      id: 'q-lines',
      title: 'Penetrations, Line Sets & Condensate',
      questions: [
        {
          id: 'q-penetration',
          text: 'Wall penetration sleeved, pitched to the exterior, and sealed weather-tight both sides',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-line-spec',
          text: 'Line set size and length are within Quilt specification for this pairing',
          critical: true,
        },
        {
          id: 'q-flares',
          text: 'Flares cut, deburred, and torqued to Quilt specification with a torque wrench',
          critical: true,
        },
        {
          id: 'q-nitrogen',
          text: 'Nitrogen purge used during brazing where brazing was required',
          critical: true,
        },
        {
          id: 'q-vacuum',
          text: 'Evacuated to 500 microns or below with a documented decay test',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-micron-reading',
          text: 'Final micron reading after decay test',
          kind: 'measurement',
          unit: 'microns',
        },
        {
          id: 'q-leak-check',
          text: 'Leak check performed at every joint with no bubbles or oil residue',
          critical: true,
        },
        {
          id: 'q-charge',
          text: 'Additional charge calculated for line length, weighed in, and recorded',
        },
        {
          id: 'q-insulation',
          text: 'Lines fully insulated with sealed seams; UV-rated protection outdoors',
          photoOnPass: true,
        },
        {
          id: 'q-line-cover',
          text: 'Line covers run straight, sealed at penetrations, and finished to the agreed appearance',
          photoOnPass: true,
        },
        {
          id: 'q-condensate-slope',
          text: 'Condensate drain has continuous fall with no sags or traps',
          critical: true,
        },
        {
          id: 'q-condensate-test',
          text: 'Condensate flow tested with water at every Cover',
          critical: true,
        },
        {
          id: 'q-condensate-term',
          text: 'Condensate terminates clear of walkways, siding, and the foundation',
        },
      ],
    },
    {
      id: 'q-outdoor',
      title: 'Outdoor Unit & Electrical',
      questions: [
        {
          id: 'q-outdoor-mount',
          text: 'Outdoor unit level and elevated above snow and flood level per Quilt guidance',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-outdoor-clearance',
          text: 'Required airflow and service clearances met on all sides',
        },
        {
          id: 'q-outdoor-isolation',
          text: 'Vibration isolation installed and unit secured against wind and snow load',
        },
        {
          id: 'q-meltwater',
          text: 'Defrost meltwater drains away and will not ice a walkway or door path',
          critical: true,
        },
        {
          id: 'q-electrical',
          text: 'Circuit, breaker, and conductor sizing match the Quilt nameplate requirements',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-disconnect',
          text: 'Disconnect within sight of the unit, labeled, and weatherproof',
          critical: true,
        },
        {
          id: 'q-grounding',
          text: 'Equipment grounded and bonded per code',
          critical: true,
        },
        {
          id: 'q-comm',
          text: 'Communication and power wiring landed per Quilt documentation and separated as required',
          critical: true,
        },
      ],
    },
    {
      id: 'q-dial',
      title: 'Dial Controllers',
      questions: [
        {
          id: 'q-dial-mount',
          text: 'Each Dial mounted at the specified height, level, and securely fastened',
        },
        {
          id: 'q-dial-location',
          text: 'Dial located away from direct sun, supply air, and heat-producing appliances',
          help: 'A Dial reading a false room temperature will make the system look broken.',
          critical: true,
        },
        {
          id: 'q-dial-pairing',
          text: 'Each Dial paired to the correct Cover and responds to input',
          critical: true,
        },
        {
          id: 'q-dial-labeling',
          text: 'Rooms named correctly in the system so the customer sees the names they expect',
        },
      ],
    },
    {
      id: 'q-commissioning',
      title: 'App Commissioning & Handoff',
      questions: [
        {
          id: 'q-wifi',
          text: 'System connected to the home Wi-Fi with a stable signal at the outdoor unit',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-app-setup',
          text: 'Home set up in the Quilt app with correct address, rooms, and zone names',
          critical: true,
        },
        {
          id: 'q-firmware',
          text: 'Firmware updated to current release and system reports healthy',
          photoOnPass: true,
        },
        {
          id: 'q-ownership',
          text: 'Account ownership transferred to the homeowner and their login confirmed working',
          help: 'Do not leave the system under an installer account.',
          critical: true,
        },
        {
          id: 'q-heat-test',
          text: 'Every zone run in heating and confirmed delivering warm air',
          critical: true,
        },
        {
          id: 'q-cool-test',
          text: 'Every zone run in cooling and confirmed delivering cold air',
          critical: true,
        },
        {
          id: 'q-delta-t',
          text: 'Delta-T at each Cover (list per room)',
          kind: 'measurement',
          unit: '°F',
        },
        {
          id: 'q-leak-watch',
          text: 'Covers run 15+ minutes in cooling and checked for condensate drips',
          critical: true,
        },
        {
          id: 'q-no-alerts',
          text: 'No alerts or faults shown in the app after full operation',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'q-noise',
          text: 'Operating noise acceptable indoors and out; no rattles or resonance',
        },
        {
          id: 'q-customer-app',
          text: 'Customer walked through the app: scheduling, zone control, and away mode',
        },
        {
          id: 'q-customer-filter',
          text: 'Customer shown how to remove and clean the Cover filters',
        },
        {
          id: 'q-customer-support',
          text: 'Customer told how Quilt support and our service line divide responsibility',
        },
      ],
    },
  ],
};
