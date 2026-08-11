import type { Template } from '../lib/types';

export const indoorAirQuality: Template = {
  id: 'indoor-air-quality',
  name: 'Indoor Air Quality — Ventilation, Filtration & Humidity',
  category: 'indoor-air-quality',
  summary: 'ERV/HRV, exhaust ventilation, filtration, dehumidification and controls.',
  sections: [
    {
      id: 'iaq-erv',
      title: 'ERV / HRV Installation',
      questions: [
        {
          id: 'iaq-model',
          text: 'Unit model matches the design and is sized for the home',
          critical: true,
        },
        {
          id: 'iaq-mounting',
          text: 'Unit mounted level and securely, with service clearance for filter and core access',
          photoOnPass: true,
        },
        {
          id: 'iaq-condensate',
          text: 'Condensate drain installed, trapped per manufacturer, and flow tested with water',
          critical: true,
        },
        {
          id: 'iaq-intake-location',
          text: 'Fresh air intake meets required separation from exhausts, flues, and contamination sources',
          help: 'Check distances to dryer vents, plumbing stacks, driveways, and combustion terminations.',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'iaq-hoods',
          text: 'Exterior hoods fitted with screens and backdraft dampers, sealed and flashed at the wall',
          photoOnPass: true,
        },
        {
          id: 'iaq-duct-insulation',
          text: 'Ducts in unconditioned space are insulated and vapor sealed against condensation',
          critical: true,
        },
        {
          id: 'iaq-duct-runs',
          text: 'Duct runs supported, no kinks, crushed sections, or excess flex',
        },
        {
          id: 'iaq-balancing',
          text: 'Supply and exhaust airflows measured and balanced within manufacturer tolerance',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'iaq-supply-cfm',
          text: 'Measured supply airflow',
          kind: 'measurement',
          unit: 'CFM',
        },
        {
          id: 'iaq-exhaust-cfm',
          text: 'Measured exhaust airflow',
          kind: 'measurement',
          unit: 'CFM',
        },
        {
          id: 'iaq-ventilation-rate',
          text: 'Delivered ventilation rate meets the ASHRAE 62.2 target for this home',
          critical: true,
        },
      ],
    },
    {
      id: 'iaq-exhaust',
      title: 'Exhaust Ventilation',
      questions: [
        {
          id: 'iaq-bath-fans',
          text: 'Bath fans deliver rated airflow and are quiet at the specified sone level',
          photoOnPass: true,
        },
        {
          id: 'iaq-fan-controls',
          text: 'Fan switches, timers, or humidistats installed, labeled, and functioning',
        },
        {
          id: 'iaq-dryer',
          text: 'Dryer and range exhaust terminate outdoors with no lint or grease restriction',
        },
        {
          id: 'iaq-makeup-air',
          text: 'Makeup air provided where required by the exhaust load',
          critical: true,
        },
      ],
    },
    {
      id: 'iaq-filtration',
      title: 'Filtration & Air Cleaning',
      questions: [
        {
          id: 'iaq-filter-cabinet',
          text: 'Media cabinet correctly sized, airtight, and installed in the right airflow direction',
          photoOnPass: true,
        },
        {
          id: 'iaq-filter-access',
          text: 'Filter is accessible without tools; size and change interval labeled at the unit',
          photoOnPass: true,
        },
        {
          id: 'iaq-static-pressure',
          text: 'Total external static pressure with the new filter is within equipment limits',
          critical: true,
        },
        {
          id: 'iaq-tesp',
          text: 'Total external static pressure',
          kind: 'measurement',
          unit: 'in. w.c.',
        },
        {
          id: 'iaq-bypass',
          text: 'No air bypasses the filter — cabinet and return joints are sealed',
        },
        {
          id: 'iaq-uv',
          text: 'UV or air purification equipment installed per manufacturer with safety interlocks',
        },
      ],
    },
    {
      id: 'iaq-humidity',
      title: 'Humidity Control',
      questions: [
        {
          id: 'iaq-dehu-mount',
          text: 'Dehumidifier mounted level with required clearance and vibration isolation',
        },
        {
          id: 'iaq-dehu-drain',
          text: 'Dehumidifier drain sloped and trapped, or condensate pump wired with safety switch',
          critical: true,
        },
        {
          id: 'iaq-dehu-duct',
          text: 'Ducted dehumidifier tie-ins do not short-cycle or pressurize the return incorrectly',
        },
        {
          id: 'iaq-humidifier',
          text: 'Humidifier (if installed) has a working humidistat, drain, and bypass damper set for season',
        },
        {
          id: 'iaq-rh',
          text: 'Indoor relative humidity at time of inspection',
          kind: 'measurement',
          unit: '% RH',
        },
      ],
    },
    {
      id: 'iaq-commissioning',
      title: 'Commissioning & Handoff',
      questions: [
        {
          id: 'iaq-controls',
          text: 'Ventilation schedule and setpoints programmed for this home, not left at defaults',
          critical: true,
          photoOnPass: true,
        },
        {
          id: 'iaq-depressurization',
          text: 'Combustion appliances re-tested for backdraft with all exhaust running at worst case',
          critical: true,
        },
        {
          id: 'iaq-monitor',
          text: 'IAQ monitor (if supplied) placed, connected, and reading plausible values',
        },
        {
          id: 'iaq-customer',
          text: 'Customer shown how to run, service, and seasonally adjust the ventilation system',
        },
      ],
    },
  ],
};
