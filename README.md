# QC2GO

A mobile-first quality control app for site visits and final walkthroughs on home
performance, indoor air quality, and heat pump installations.

Built for one job: a QC inspector standing in a crawlspace with one hand free.
Every question is a single tap — **Yes** (green check), **No** (red X), or **N/A**.
Answering **No** opens a deficiency panel that will not let the inspection be signed
off until it has both a written explanation and a photo.

## How it works

**Jobs are the top level.** Everything is organized by job name. A job holds the
customer, address, salesperson, team leader, and every inspection run against it.

**Every checklist shares a common opening.** Two blocks are prepended to all five
checklists:

1. **Job Information** — project name, customer name, address, salesperson, team
   leader, job/work order number, permit number, inspector, date, crew, whether the
   customer was present, outdoor temperature, and utility/rebate program. Prefilled
   from the job record so the inspector confirms rather than retypes.
2. **Universal QC Standards** — 18 company-wide checkpoints covering scope match,
   change orders, permits, serial-number capture, warranty registration, site
   cleanliness, penetration sealing, CO/smoke alarms, combustion safety, customer
   walkthrough, and handoff documentation.

Adding a standard to `src/templates/shared.ts` adds it to every checklist at once.

**Then the system-specific checklist:**

| Checklist | Covers |
| --- | --- |
| Home Performance — Insulation & Air Sealing | Prep/safety, air sealing, insulation, crawlspace, blower door + combustion safety testing |
| Indoor Air Quality | ERV/HRV, exhaust ventilation, filtration, humidity control, commissioning |
| Mitsubishi Ducted Hyper-Heat | Outdoor unit, line set & refrigerant, electrical & controls, air handler & distribution, startup |
| Mitsubishi Ductless Hyper-Heat | Indoor heads, penetrations & condensate, line sets, multi-zone branch box, outdoor unit, startup |
| Quilt Ductless | Design verification, Covers, line sets & condensate, outdoor unit, Dial controllers, app commissioning |

### Question types

- **Yes / No / N/A** — the standard checkpoint.
- **Critical** — a checkpoint flagged as safety- or contract-significant.
- **Photo for record** — a passing item that is normally photographed anyway
  (data plates, micron gauges, test screens). Advisory, listed at review, never blocking.
- **Measurement** — a recorded value rather than a judgement (CFM50, micron
  reading, static pressure, delta-T). Shown inline and carried into the report.

### Sign-off rules

An inspection cannot be completed until:

- every required Job Information field is filled,
- every Yes/No/N/A question is answered,
- every **No** has a written explanation **and** at least one photo,
- the inspector has signed, and
- the customer has signed, when it is a final walkthrough with the customer present.

Remaining blockers are listed at review and each one links straight back to the
question it refers to.

### Report

The completed inspection renders as a full report — job information, summary notes,
every section with pass/fail marks, deficiency explanations with photos, measured
values, and both signatures. Print styles are set up so **Print → Save as PDF**
produces the customer-facing document. Raw data exports as JSON.

## Offline and storage

Everything is stored on the device in IndexedDB — jobs, answers, photos, and
signatures. Nothing is uploaded anywhere. The app is a PWA with a service worker,
so it installs to the home screen and runs with no signal; a banner appears when the
device goes offline to make that explicit. Photos are downscaled to a 1600px long
edge before storage, since a single inspection routinely carries 30+ of them.

Because storage is per-device, a report should be exported or saved as PDF before
the phone is wiped or replaced.

## Development

```bash
npm install
npm run dev        # vite dev server
npm run typecheck
npm run build      # tsc + vite build into dist/
npm run preview    # serve the build on :4173
```

### Smoke test

`scripts/smoke.mjs` drives the whole flow in a real browser (Playwright): creates a
job, runs an inspection, documents a deficiency with a photo, signs off, and asserts
the record survives a hard reload.

```bash
npm run build
npm run preview &
npm run smoke      # writes screenshots to ./smoke-shots
```

Set `SMOKE_URL`, `SMOKE_OUT`, or `CHROMIUM_PATH` to override the defaults.

## Layout

```
src/
  lib/
    types.ts        domain model
    db.ts           IndexedDB repositories (jobs, inspections, photos, settings)
    store.tsx       React context over the repos, with debounced write-through
    inspection.ts   progress, deficiencies, and sign-off blocker rules
    image.ts        photo downscaling
  templates/
    shared.ts       job information fields + Universal QC Standards
    *.ts            the five system checklists
  components/       question card, photo capture, signature pad, UI primitives
  screens/          jobs, job, template picker, inspection runner, review, report, settings
```

### Adding a checklist

Add a file to `src/templates/` exporting a `Template`, then register it in
`src/templates/index.ts`. The shared sections are prepended automatically.
