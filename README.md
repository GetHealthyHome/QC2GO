# QC2GO

**Quality in motion.**

A mobile-first quality control app for site visits and final walkthroughs on home
performance, indoor air quality, and heat pump installations.

Built for one job: a QC inspector standing in a crawlspace with one hand free.
Every question is a single tap — **Yes** (green check), **No** (red X), or **N/A**.
Answering **No** opens a deficiency panel that will not let the inspection be signed
off until it has both a written explanation and a photo.

## How it works

**Customers are the top level.** Everything is organized by customer: the address,
work scope, salesperson, team leader, and every checklist ever run there. The home
screen is a customer search; salesperson and team leader are dropdowns an admin
maintains under Settings → People, so field staff pick a name instead of typing one.

**Jobs run across days.** A checklist is stamped with the visit day it covers, so a
job with attic work on Tuesday and commissioning on Thursday keeps them separate.
Which checklists apply is chosen once per customer with tick boxes; from then on any
of them can be run on any day.

**A completed checklist becomes a QC Card** — the date, the score, and the pass/fail
split — filed under that customer and grouped by day. Score is the percentage of
judged items that passed; N/A items are excluded so skipping half a checklist cannot
inflate it, and any critical failure forces the card red however high the percentage.

**Near me** finds customers close to where you are standing. Locations come from the
device GPS, captured on the customer record while on site — addresses are not
geocoded, because that would mean a network call in exactly the places with no signal.

**Quick Safety Audit** launches straight from the home screen, against an existing
customer or a brand new address, for the sweep that happens on arrival.

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

Both are editable by an admin in one place, so a new company-wide standard lands
on every checklist at once.

**Then the system-specific checklist.** These five ship with the app and seed the
editable store on first run; admins can change them or add their own.

| Checklist | Covers |
| --- | --- |
| Home Performance — Insulation & Air Sealing | Prep/safety, air sealing, insulation, crawlspace, blower door + combustion safety testing |
| Indoor Air Quality | ERV/HRV, exhaust ventilation, filtration, humidity control, commissioning |
| Mitsubishi Ducted Hyper-Heat | Outdoor unit, line set & refrigerant, electrical & controls, air handler & distribution, startup |
| Mitsubishi Ductless Hyper-Heat | Indoor heads, penetrations & condensate, line sets, multi-zone branch box, outdoor unit, startup |
| Quilt Ductless | Design verification, Covers, line sets & condensate, outdoor unit, Dial controllers, app commissioning |

A generated inventory of every shipped checklist — all sections, checkpoints,
flags, and guidance — lives in [`docs/CHECKLISTS.md`](docs/CHECKLISTS.md), with
[`docs/checklists.csv`](docs/checklists.csv) for spreadsheet review. Refresh both
with `npm run checklists:export` after changing anything under `src/templates/`.

## Where this is headed

The app is built against the VLX Home Services QC Platform technical
requirements document. [`docs/TRD-CROSSREFERENCE.md`](docs/TRD-CROSSREFERENCE.md)
reads that document line by line against what exists today — what is met, what is
partly met, what has not been started, and the handful of requirements worth
adapting rather than copying — and ends with a sequenced list of what to build
next.

### Photo evidence

Any photo can be marked up — arrow, box, freehand, or a text label, in one of
three colours that carry meaning rather than decorate. A photo of a whole
crawlspace with "rim joist left open at the south wall" underneath asks the
customer to find it themselves; an arrow does not.

Marks are stored beside the photo as coordinates, never burned into it, so the
evidence stays exactly as the camera produced it and a mark in the wrong place
can be moved. They are held as fractions of the image, which is what lets the
same arrow land in the same place on a phone, in the report, and on paper. Marks
can be added while an inspection is open and not after it is signed.

Every photo is stamped, in the pixels, with the UTC time it was taken, the
coordinates if anything could supply them, the inspector and the inspection id.
Pixels rather than metadata, because metadata does not survive being exported to
a PDF, printed, screenshotted, or pulled out of a report and emailed on — which
is most of the ways one of these photos is ever looked at.

The capture time and any coordinates are read from the file **before** it is
downscaled, since re-encoding through a canvas discards them. Where the camera
recorded no location, the device's own last known position is used and labelled
as such — never waited on, because a photo that takes fifteen seconds to save
while a phone hunts for a fix in a crawlspace is worse than a photo without
coordinates.

### Question types

- **Yes / No / N/A** — the standard checkpoint.
- **Critical** — a checkpoint flagged as safety- or contract-significant.
- **Photo for record** — a passing item that is normally photographed anyway
  (data plates, micron gauges, test screens). Advisory, listed at review, never blocking.
- **Measurement** — a recorded value rather than a judgement (CFM50, micron
  reading, static pressure, delta-T). Shown inline and carried into the report.

## Companies and roles

QC2GO is multi-tenant. Every record belongs to a company, and an account belongs
to exactly one — that single value is the whole boundary, and every policy in the
database is a comparison against it. Two companies using the same deployment
cannot see each other's customers, inspections, photos, checklists, or even each
other's staff lists.

Three roles:

- **Inspector** — runs inspections, and recalls any past one from the Completed
  screen (searchable by job, customer, checklist, or inspector).
- **Admin** — everything an inspector can do, plus the checklist editor.
- **Owner** — everything an admin can do, plus inviting people into the company.

A company is created deliberately, in SQL. From there its owner invites their own
staff from **Settings → People**: they enter an address and a role, the person
gets an email, and following the link signs them in and asks them to choose a
password. Nobody reaches a company any other way — an account with no invitation
belongs to no company and sees an empty app, which it says plainly rather than
looking like lost data.

[`supabase/README.md`](supabase/README.md) covers setting up the first company,
and `npm run check:migrations` proves the boundary holds by creating two
companies and trying to cross between them.

## Admin edit mode

Admins build and rework checklists in the app, no code change needed:

- Create a checklist from scratch, or duplicate an existing one.
- Add, rename, reorder, and delete sections.
- Add, edit, reorder, and delete checkpoints; set each one's type (Yes/No,
  measurement with a unit, or free text) and its **Critical** and **Photo for
  record** flags.
- Edit the shared Job Information fields — label, type, required, choices,
  half-width — and the Universal QC Standards block that opens every checklist.
- Archive a checklist to hide it from inspectors without deleting history.
- Reset any shipped checklist back to the version that came with the app.

Reordering uses up/down buttons rather than drag handles — reliable on a phone,
with gloves, one-handed.

### Edits never rewrite history

Every inspection captures its own copy of the checklist the moment it starts.
Rewording a question or reordering a section changes what future inspections ask;
it does not touch an inspection already under way or signed. The smoke test
asserts exactly this: after adding a checkpoint to the universal section, a
previously signed report is unchanged while a new inspection on the same job
picks it up.

### Punch list

Every failed checkpoint across a customer's inspections gathers into one list,
critical items first. The question an inspector arrives with on a return visit is
"what am I here to re-check?", and this answers it without opening past
inspections one at a time.

Each item is read back through the snapshot the inspection froze, so the wording
shown is the wording that was actually failed rather than whatever the checklist
says today. Marking one corrected records the correction **on the customer**, not
on the inspection — a signed inspection stays exactly as it was signed.

### Reopening a signed inspection

An admin can unlock a signed record, but not silently. A reason is required, it
is shown on the report from then on, and the server writes it to an append-only
ledger that nothing — not an admin, not an owner — can edit or delete.

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

Every report is headed with the company handing it over: its name, and its logo
in a **fixed area reserved whether or not a logo has been uploaded**. That is the
point of reserving it — a report laid out with the placeholder is laid out
identically once a company adds its mark, so nothing reflows and no page break
moves. Any logo shape fits: it is scaled to sit inside the box, never cropped or
stretched. An owner uploads it under Settings → Company branding, where the
preview is the report's actual slot at the size the report draws it.

The completed inspection renders as a full report — job information, summary notes,
every section with pass/fail marks, deficiency explanations with photos, measured
values, and both signatures. Print styles are set up so **Print → Save as PDF**
produces the customer-facing document. Raw data exports as JSON.

## Accounts and sign-in

The app requires a sign-in **when a backend is configured**, and runs local-only
without one. Two variables decide which:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Set both (in Vercel → Settings → Environment Variables, and in a local `.env` for
development) and the app gates every route behind a sign-in, reading the person's
role from `profiles.role`. Leave them unset — as the dev server and CI do — and the
app stays local-only with no account required.

That fallback is convenient and dangerous in equal measure: a production deploy
missing these variables would silently have no authentication. Two things guard
against it. The app shows a **Local mode** banner whenever it runs unconfigured, and
CI builds a configured copy on every PR and asserts that nothing is reachable
without signing in (`npm run check:auth-gate`).

Only the **publishable** key belongs in these variables. It ships inside the client
bundle by design and is protected by row-level security. The `service_role` key
bypasses RLS entirely and must never reach a browser.

Accounts arrive by invitation and there is no self-signup: an owner invites an
address, and the signup trigger puts whoever takes it up into that company with
the role they were given. Sending the email needs the `service_role` key, so it
happens in a Supabase Edge Function (`supabase/functions/invite-user`) rather
than in the browser — see [`supabase/README.md`](supabase/README.md), which also
covers creating a company and its first owner.

## Backend

The app is local-first and works standalone today. `supabase/migrations/0001_init.sql`
is the target schema — tables, roles, row-level security, a private photo storage
bucket, and an office summary view. It has been executed against PostgreSQL 16 and
runs clean. See [`supabase/README.md`](supabase/README.md) for setup and for what
is still to build.

Google Sheets was considered and rejected as the store: it cannot hold photo
evidence, a browser app cannot write to it without a server in front, and a
60-checkpoint inspection does not flatten into a row. A one-way mirror from
Supabase into a Sheet remains a good way to give the office a spreadsheet view.

## Deploying

`vercel.json` pins the Vite preset, the build command, and the output directory, so
importing the repo at [vercel.com/new](https://vercel.com/new) needs no configuration —
pick `GetHealthyHome/QC2GO`, deploy, and every push to `main` ships automatically.

It also sets the headers this app specifically needs:

- **Hashed assets** (`/assets/*`) cached immutably — the filename changes when the
  contents do, so there is nothing to revalidate.
- **`sw.js`, the workbox runtime, and the manifest** revalidated on every request.
  This one is not boilerplate: the service worker is how a phone learns a new
  version exists, so a CDN-cached copy leaves an inspector on a stale build with no
  indication anything is wrong.
- **`nosniff`, `DENY` framing, `strict-origin-when-cross-origin`**, and a
  `Permissions-Policy` allowing the camera (the deficiency photo flow needs it)
  while denying geolocation and microphone.

No SPA rewrite is needed — the app uses `HashRouter`, so every route is served
from `/`.

`npm run check:vercel` validates the config, and CI runs it before typecheck. An
invalid `vercel.json` does not fail the build or the tests; it fails at deploy
time, after everything else has gone green.

An HTTPS origin is required for the parts that matter in the field. Service workers
only register on `https://` or `localhost`, so a LAN address like
`http://192.168.1.x:5173` gives no home-screen install and no offline mode. Use it
to click through screens, not to test offline behaviour.

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

### CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

1. **Typecheck & build** — `npm run typecheck` then `npm run build`.
2. **Migrations & tenant isolation** — applies every migration to a throwaway
   PostgreSQL, then creates two companies and tries to cross between them. The
   build job also runs `check:invite-authorization`, which covers the one piece
   of code that runs with a key that bypasses row-level security.
3. **Smoke test** — serves the build and drives it in headless Chromium.

Screenshots from the smoke run are uploaded as an artifact on every run, pass or
fail, so a red build can be inspected without reproducing it locally.

### Smoke test

`scripts/smoke.mjs` drives the whole flow in a real browser (Playwright): creates a
job, runs an inspection, documents a deficiency with a photo, signs off, asserts the
record survives a hard reload, then switches to admin, edits the shared section,
builds a checklist from scratch, reorders checkpoints, and verifies that the edit
leaves the signed report untouched while a new inspection picks it up.

Every assertion is a real check — the script prints `ok`/`FAIL` per item and exits
non-zero if any fail or if the page logged a console error.

```bash
npm run build
npm run preview &
npm run smoke      # writes screenshots to ./smoke-shots
```

Set `SMOKE_URL`, `SMOKE_OUT`, or `CHROMIUM_PATH` to override the defaults.

### Migration and isolation test

`scripts/check-migrations.mjs` applies every migration to a real PostgreSQL and
then attacks the tenancy boundary from the inside: as one company it tries to
read, update, delete and insert into another's customers, inspections, roster,
shared config, tombstones and photo bucket. It also replays what the live
database will do — three migrations, a company's worth of data, then the fourth —
and checks the data was adopted rather than orphaned.

A row-level-security policy is the one kind of code where "it compiles" and "it
is correct" are furthest apart. A policy with a typo installs fine; so does one
that admits every signed-in caller.

```bash
DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run check:migrations
```

It drops and recreates the `public` schema, so point it at something disposable.

## Layout

```
src/
  lib/
    types.ts        domain model
    db.ts           IndexedDB repositories (jobs, inspections, photos, settings)
    store.tsx       React context over the repos, with debounced write-through
    inspection.ts   progress, deficiencies, and sign-off blocker rules
    image.ts        photo downscaling
    checklist.ts    snapshot capture, checklist resolution, reorder helpers
  templates/
    shared.ts       seed job information fields + Universal QC Standards
    *.ts            the five seed checklists
  components/       question card, photo capture, signature pad, section editor, UI primitives
  screens/          jobs, job, template picker, inspection runner, review, report,
                    completed, checklists, checklist editor, shared editor, settings
supabase/
  migrations/       schema, RLS, storage bucket, summary view
```

### Adding a checklist

Use the in-app editor as an admin. To change what ships by default, add a file to
`src/templates/` exporting a `Template` and register it in `src/templates/index.ts` —
those seed the editable store on first run and back the "reset to shipped version"
action.
