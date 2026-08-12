# QC2GO vs. the VLX Platform TRD

A line-by-line reading of the *VLX Home Services Quality Control Platform —
Technical Requirements Document, v2.4* against what QC2GO actually is today.

Section 13 at the end records what has changed since the first draft; the tables
themselves are kept current rather than frozen.

The TRD is the target. This document exists so that the distance to it is a
known quantity rather than a guess: what already satisfies a requirement, what
satisfies part of one, what has not been started, and — for the handful of
requirements that fight the thing QC2GO is deliberately good at — what should be
adapted rather than copied.

**Status legend**

| | Meaning |
| :---: | --- |
| **Built** | The requirement is met, in the spirit the TRD describes. |
| **Partial** | Something real exists and covers part of it; the rest is missing. |
| **Gap** | Not started. |
| **Adapt** | The requirement conflicts with a deliberate QC2GO decision; the note says what to build instead. |

---

## 1. Verdict at a glance

QC2GO today is a **complete, working vertical slice of the TRD's field path**,
built narrow and deep: one inspector, one job, one checklist, offline, signed,
reported. It is not yet the platform around that slice.

| TRD Module | Coverage | One-line read |
| --- | :---: | --- |
| 1 — Template Builder & Field Types | **~40%** | Full section/checkpoint authoring with versioned snapshots; 3 question types against the TRD's 15+, and no conditional logic, repeatable sections, or formulas. |
| 2 — Evidence Capture & Media | **~25%** | Photos captured, downscaled, stored offline and rendered into the report. No annotation, no watermarking, no video/audio, no barcode, no AI. |
| 3 — KYPiT Verification | **~5%** | Nothing of the risk engine exists. GPS is captured on the customer record, not on the evidence. |
| 4 — Scoring, Workflows & Automation | **~40%** | A real scoring model with critical-failure override and hard sign-off blockers. No tasks, no punch list, no approval chain, no triage queue. |
| 5 — Teams, Security & Access | **~60%** | Supabase auth, per-company tenancy with three roles, row-level security proven by an isolation suite, invitation-based onboarding, tombstoned deletes. No second (team) role layer, no external sharing, no SSO, no audit ledger. |
| 6 — Reports, Exports & Integrations | **~25%** | Print-to-PDF report and JSON export; a Postgres summary view for the office. No branded layout engine, no .docx/.xlsx, no webhooks, no cloud sync. |

The overall shape of the gap is consistent: **QC2GO has the record, and does not
yet have the systems that consume the record.** Evidence integrity (Module 3),
work orders (Module 4), and distribution (Module 6) are all downstream of a
completed inspection, and all three are close to empty.

---

## 2. Platform-level deltas

Four differences run underneath every module and are worth stating once.

**Web PWA, not native iOS/Android.** The TRD assumes native apps throughout
(§4 workflow 1, "Opens Native Mobile App"). QC2GO is a Vite/React PWA with a
service worker, installed to the home screen. This costs the parts of Module 2
that need real camera control — locked capture ratios, video/audio recording,
a live GPS overlay in the viewfinder — since `AddPhotoButton`
(`src/components/Photos.tsx:121`) hands off to the OS camera via
`capture="environment"` rather than driving it. Everything else in the TRD is
reachable from the web. **This is the single decision most worth revisiting**,
because Module 2 and Module 3 both depend on it.

**Local SQLite → IndexedDB.** The TRD names SQLite for on-device caching
(§4). QC2GO uses IndexedDB (`src/lib/db.ts`) with an outbox-drained sync engine
(`src/lib/sync.ts`). Functionally equivalent and correct for the platform choice
— treat the TRD's "SQLite" as descriptive, not prescriptive.

**A thin middleware tier, newly.** The TRD's architecture diagram puts an API
Gateway between clients and services. QC2GO talks to Supabase directly from the
browser with row-level security as the boundary, and that remains the right
default — but `supabase/functions/invite-user` established the server tier that
everything needing real compute was queued behind: webhooks, PDF/DOCX rendering,
cloud sync, scheduled reports, any KYPiT signal. Each of those is now an Edge
Function to write rather than a piece of architecture to decide.

**Multi-tenant, as of `0004_organizations.sql`.** This was the largest gap in the
first draft of this document and is now closed. Every tenant-owned table carries
`org_id`, an account belongs to exactly one company, and every policy in the
database compares against it. The TRD's `organization_id` has a home; its
two-layer org/team hierarchy does not yet — there is one layer, of three roles.

---

## 3. Module 1 — Template Builder & Field Types

| TRD requirement | Status | As built |
| --- | :---: | --- |
| Visual form builder, field reordering, section grouping | **Built** | `ChecklistEditorScreen` + `SectionEditor`: create/duplicate/delete checklists, add/rename/reorder/delete sections and checkpoints. Reordering is up/down buttons, not drag — a deliberate call for gloved, one-handed use (README "Admin edit mode"). |
| Inline help text / SOP instructions | **Built** | `Question.help` and `Section.description` (`src/lib/types.ts:14`), rendered under each checkpoint. |
| Static reference instructions with **example photos** | **Gap** | Text only. No target-example image on a section or field. |
| 15+ field types | **Partial** | Three question kinds — `yesno`, `measurement` (with unit), `text` (`src/lib/types.ts:6`) — plus six job-information field types: `text`, `textarea`, `date`, `select`, `number`, `tel` (`src/lib/types.ts:35`). Photo attaches to any checkpoint; signature is fixed to the two sign-off slots. |
| — Checkbox / Dropdown as a checkpoint type | **Gap** | Exists for job-info fields (`select`), not for checkpoints. |
| — Date/Time, Slider as checkpoint types | **Gap** | — |
| — Number precision / default values | **Gap** | `measurement` stores a free string with a unit label. |
| — Photo as a first-class field type | **Adapt** | QC2GO attaches photos to *any* checkpoint rather than making photo a field type, and `photoOnPass` marks checkpoints that should carry one. This is better for QC work than the TRD's model — keep it, and add a "photo required" hard flag alongside the advisory one. |
| — Video / Audio | **Gap** | — |
| — GPS field | **Partial** | GPS is captured once per customer (`src/lib/geo.ts:12`), not per field, and never resolved to an address (deliberate — geocoding is a network call in exactly the places with no signal). |
| — Barcode / QR (14 formats) | **Gap** | High value here: serial-number capture is already a Universal QC Standard, typed by hand today. |
| — Signature (geotagged, timestamped) | **Partial** | `SignatureRecord` carries name + `signedAt` (`src/lib/types.ts:144`). Not geotagged. |
| — Instacount | **Gap** | — |
| — Calculated fields (SUM/AVG/MIN/MAX) | **Gap** | Scores are computed (`scoreOf`, `src/lib/inspection.ts:257`) but there is no user-authored formula. |
| Conditional logic (if/then, nested, score-triggered) | **Gap** | No branching of any kind. Every checkpoint on a checklist is always shown and always required. |
| Repeatable sections (per room / per zone / per head) | **Gap** | **The most costly gap in this module for the actual business.** A ductless job with five heads runs the same section five times; today that means five near-identical checkpoints authored by hand, or one checkpoint covering all heads. |
| AI template builder (natural language) | **Gap** | — |
| Public template library (1,000+) | **Adapt** | Six shipped checklists (`src/templates/index.ts`), all written for this company's actual scopes, plus in-app authoring. A generic public library is the wrong target; a *shared company library* synced across devices is already effectively there via the `templates` table. |
| Template versioning — revision log, side-by-side diff, rollback | **Partial** | This is where QC2GO is *stronger* than the TRD in one respect and weaker in another. Stronger: every inspection freezes its own `TemplateSnapshot` at start (`src/lib/checklist.ts:16`), so history is structurally immune to later edits — the TRD only promises rollback "without altering historical records", which snapshots guarantee outright. Weaker: `version` is a bare counter, there is no per-change revision log (who/when/what), no diff view, and the only rollback is "reset to shipped version". |

---

## 4. Module 2 — Evidence Capture & Media Management

| TRD requirement | Status | As built |
| --- | :---: | --- |
| In-app camera capture | **Partial** | OS camera via file input (`src/components/Photos.tsx:121`), multi-select, rear camera on phones, file picker on desktop. |
| Locked capture ratios / orientations | **Gap** | Needs a real in-app viewfinder. |
| Media quality tiers (4 image, 4 video) | **Gap** | One fixed tier: 1600px long edge, JPEG q0.82 (`src/lib/image.ts`). Sensible for 30+ photos on-device, but not configurable, and there is no "ultra high quality" path for a disputed defect photo. |
| Image annotation — crop, rotate, annotate, text, highlight, freehand | **Gap** | **Zero of the six tools.** A deficiency photo goes into the report exactly as shot, with the written explanation as the only pointer to what is wrong. Highest-value gap in this module: it is pure client-side canvas work, needs no backend, and directly improves the customer-facing report. |
| Metadata watermarking (UTC time, GPS, inspector, inspection ID) | **Gap** | Nothing is burned into the pixels. Compounding problem: `compressImage` re-encodes through a canvas, which **strips the original EXIF entirely** — so today a QC2GO photo carries *less* provenance than the raw camera file. Any KYPiT work must read EXIF before compression and carry it forward explicitly. |
| Barcode / QR scanning into mapped fields | **Gap** | — |
| Instacount visual counting | **Gap** | — |
| AI Walkthroughs (video/voice → mapped fields) | **Gap** | — |
| AI Scribe (grammar, tone, summarize) | **Gap** | Deficiency notes are typed raw. A narrow, cheap version — clean up one note on demand — is a strong early AI win because the note text goes straight to the customer. |
| Copy camera notes into template fields | **Partial** | `PhotoRecord.caption` exists in the model and round-trips through sync (`src/lib/syncMap.ts:164`) but is never set or shown in the UI. |
| Photos survive offline and sync later | **Built** | Beyond the TRD: photos are pulled as records and the bytes fetched lazily on first render (`supabase/README.md`, "Photos are pulled as records, not bytes"). |

---

## 5. Module 3 — KYPiT Verification & Audit Integrity

| TRD signal | Status | Note |
| --- | :---: | --- |
| Image signal — EXIF vs system time, geofence, AI-generation check | **Gap** | See the EXIF-stripping problem above. Geofencing is *nearly* reachable: `Customer.location` and `distanceMiles` already exist (`src/lib/geo.ts:50`), so "was this photo taken within N metres of the job?" is a small step once photos carry their own coordinates. |
| User identity — carrier, email domain, behaviour profile | **Gap** | — |
| Domain analytics — WHOIS, MX, reputation | **Adapt** | Written for a platform accepting submissions from unknown contractors. QC2GO accounts are created by an administrator in the Supabase dashboard with no self-signup — the threat this defends against does not exist here. Skip unless the app is opened to subcontractors. |
| Activity analytics — completion velocity, step sequencing, reversions | **Gap** | The data to compute it is already stored: `Response.answeredAt`, `createdAt`, `completedAt`. Pencil-whipping detection ("60 checkpoints answered in 90 seconds") is the cheapest genuinely useful KYPiT signal available and needs no new capture at all. |
| IP analytics — ISP, VPN/Tor, mock location | **Gap** | — |
| Risk score + flag routing to a review queue | **Gap** | — |
| Immutable record after sign-off | **Partial** | A completed inspection is read-only in the app (`src/screens/InspectionScreen.tsx:78`) and the server refuses edits to a completed record except by an admin (`inspections_update_own_open` policy). But "Reopen for editing" (`src/screens/ReportScreen.tsx:59`) takes **no rationale**, and nothing is written to an audit ledger. The TRD requires both. This is a small, high-integrity fix. |

**Honest read:** Module 3 is the least-started module and the one where the
inspiration doc most exceeds current need. Two pieces of it — velocity analysis
and photo geofencing — are cheap, genuinely useful for a company running its own
crews, and worth doing early. The rest (carrier lookup, WHOIS, VPN detection,
generative-AI image forensics) are third-party-vendor purchases that only pay off
against adversarial external submitters.

---

## 6. Module 4 — Scoring, Workflows & Automation

| TRD requirement | Status | As built |
| --- | :---: | --- |
| Scoring engine — pass/fail thresholds, composite % | **Partial** | `scoreOf` (`src/lib/inspection.ts:257`): percentage of judged items passed, N/A excluded so skipping cannot inflate; `scoreBand` (`:285`) gives pass ≥95 / watch ≥85 / fail, with **any critical failure forcing fail regardless of percentage**. Section-level progress exists (`sectionProgress`). |
| Configurable point allocations (0–100) per answer | **Gap** | Every checkpoint weighs the same. Thresholds are constants in code, not settings. |
| Auto-flagging → Supervisor Triage Queue | **Gap** | Failures are visible on the inspection and on its QC card, but nothing routes anywhere or lands in anyone's queue. |
| Custom flag library, colour-coded, sticky flag nav | **Partial** | Two fixed flags — `critical` and `photoOnPass` (`src/lib/types.ts:22`) — set per checkpoint by an admin, and consistently colour-coded in the UI. No user-defined flag set, no in-inspection flag navigation bar. |
| Tasks & work orders, `New → Assigned → To Do → In Progress → Done → Verified` | **Gap** | No task entity exists. |
| Punch lists & deficiency tracking to sign-off | **Built, less assignment** | `src/lib/punch.ts` + `PunchListScreen`: every failed checkpoint across a customer's inspections, critical first, each linking back to the inspection that raised it, closable with a note on a re-check. Read back through each inspection's frozen snapshot, so the wording is what was actually failed. Still missing: assignment to a person or subcontractor. |
| Custom statuses & approval routing (`Submitted → QA Review → Client Approved → Archived`) | **Gap** | `InspectionStatus` is `in-progress \| completed` (`src/lib/types.ts:151`). |
| Inspection locking with rationale log on override | **Built** | A completed inspection is read-only in the app and the server refuses edits to one from anybody but an admin. Unlocking now requires a reason (`src/screens/ReportScreen.tsx`), shows it on the report from then on, and a trigger copies it into `audit_log` — a table with a select policy and no insert, update or delete policy at all, so only a `security definer` trigger can write it and nothing can change it. |
| Daily activity reports (batch PDF, emailed/webhooked) | **Gap** | Needs the server tier. |
| Hard sign-off blockers | **Built — beyond the TRD** | `completionBlockers` (`src/lib/inspection.ts:142`) refuses sign-off until every required info field is filled, every checkpoint answered, **every No carries both a written explanation and a photo**, and both required signatures are present — each blocker deep-linking back to its question. The TRD never asks for this; it is the strongest thing in the app. |

---

## 7. Module 5 — Teams, Security & Access Control

| TRD requirement | Status | As built |
| --- | :---: | --- |
| Organizations as the tenancy boundary | **Built** | `organizations`, and `org_id` on every tenant-owned table (`supabase/migrations/0004_organizations.sql`). One company per account — `profiles.org_id` — so every policy is a single scalar comparison rather than a join. An account with no company sees an empty app and is told why. |
| Org roles: Owner / Super Admin / Admin / Member | **Partial** | Three of the four: `owner`, `admin`, `inspector`. Owner manages members and the company; admin authors checklists and amends signed records. Super Admin has no equivalent and no current need. |
| Team roles: Team Admin / Contributor / Focused Access / Viewer | **Gap** | There is one role layer, not two. Teams inside a company are not modelled. |
| Provisioning and onboarding | **Built** | A company is created deliberately in SQL; from there its owner invites staff from Settings → People. The `invite-user` Edge Function sends the email, and the signup trigger binds the new account to that company with that role. No invitation means no company. |
| Third-party sharing — Assignee / Collaborator / Viewer, secure link over email/SMS, expiry, passcode | **Gap** | Nothing leaves the app except a printed PDF or a JSON file. A read-only expiring link to a finished report is the obvious first piece and the one a customer would actually use. |
| SSO — SAML 2.0 / OIDC, OTP, OAuth | **Partial** | Supabase email + password, admin-provisioned, no self-signup. Supabase supports OAuth and OTP with configuration; SAML needs a paid tier. |
| SOC 2 Type II, annual pen testing | **Gap** | Organizational, not code. |
| Field-level immutable audit log (who, what, when, old, new) | **Partial** | `audit_log` (`0006`) exists and is genuinely append-only, but it records one action: a signed inspection being unlocked. Deletes leave tombstones (`0003`). Ordinary updates still overwrite in place with no history — the table is now there to extend rather than to build. |
| Tenant isolation is verified, not assumed | **Built — beyond the TRD** | `npm run check:migrations` applies every migration to a real PostgreSQL, then attempts as one company to read, update, delete and insert into another's customers, inspections, roster, shared config, tombstones and photo bucket. CI runs it on every pull request. The TRD asks for SOC 2 and annual pen testing; this is the part of that promise that can be kept in the repository. |
| Auth cannot be silently absent in production | **Built — beyond the TRD** | The app runs local-only without Supabase env vars, which is convenient and dangerous; a **Local mode** banner makes it visible, and CI builds a configured copy on every PR and asserts nothing is reachable without signing in (`npm run check:auth-gate`). |

---

## 8. Module 6 — Reports, Exports & Integrations

| TRD requirement | Status | As built |
| --- | :---: | --- |
| Branded PDF — logos, header/footer themes, pass/fail badges, annotated galleries | **Partial** | `ReportScreen` renders the full record — job info, summary notes, every section with pass/fail marks, deficiency explanations with photo grids, measured values, both signatures — with print styles tuned so **Print → Save as PDF** produces the customer document. Pass/fail badges are there, and as of `0005_branding.sql` so is a per-company logo in a fixed letterhead slot (`src/lib/branding.ts`), reserved so adding one never reflows the page. Missing: theming, layout presets, server-side rendering. |
| Layout presets (Quality Audit / Executive / Client Facing / Word) | **Gap** | One layout. |
| Custom Word `.docx` with `{{field}}` tags | **Gap** | — |
| Excel exports (raw / pivot / summary) | **Partial** | JSON export only (`ReportScreen.exportJson`). `docs/checklists.csv` is a CSV of *checklist definitions*, not results. The Postgres view `inspection_summary` (`supabase/migrations/0002_customers.sql:97`) already flattens pass/fail counts per inspection and is one step from a real office spreadsheet. |
| REST API & webhooks (`inspection.created/completed`, `task.flagged`) | **Gap** | Supabase exposes PostgREST over the tables, but none of the TRD's `/v1` contract exists and nothing fires on completion. |
| Cloud storage auto-sync (Drive / Dropbox / OneDrive / SharePoint, `/Client/Project/Year/`) | **Gap** | — |
| BI connectors (Power BI, Looker Studio, Metabase) | **Partial** | Any of them can point at Postgres today; `inspection_summary` is a usable starting view. No curated dataset or dashboard. |

---

## 9. UI/UX blueprints (TRD §3)

| Layout | Status | Note |
| --- | :---: | --- |
| 1 — Template Builder Web Canvas | **Partial** | `ChecklistEditorScreen` covers the centre canvas. No left field palette (there are only three question kinds to drag) and no right inspector panel (properties are inline). Both arrive naturally with more field types. |
| 2 — Mobile Field Inspection | **Built** | The closest match in the app. Offline badge (`OfflineBanner`), progress metrics, one-tap Yes/No/N-A tiles, inline Add Photo, sticky bottom bar. Missing from the TRD's bar: flag navigation and voice dictation. |
| 3 — Mobile Evidence & Camera Annotator | **Gap** | No annotator, no GPS/timestamp overlay, no capture-mode toggle. `PhotoViewer` is view-only. |
| 4 — Report Generation & Layout Engine | **Partial** | Report preview and download exist; no preset switcher, no share, no email. |
| 5 — Mobile AI Walkthrough & Session Summary | **Gap** | — |
| 6 — Tasks, Punch Lists & Work Order Center | **Gap** | `CompletedScreen` is the nearest thing — a searchable history of finished inspections — but it is a record, not a queue. |

QC2GO also ships three screens the TRD never describes, all of which came from
the actual job rather than from the spec: **customer-first navigation** (the top
level is the customer, not the form), **Near me** (`customersNear`,
`src/lib/geo.ts:72`), and **Quick Safety Audit** launched straight from the home
screen against an existing customer or a brand-new address. Keep all three.

---

## 10. Workflows (TRD §4)

**Workflow 1 — Jobsite walkthrough.** Followed nearly end to end. Open app →
select assigned checklist → capture evidence → fill dynamic fields → cache
locally → background sync on reconnect all work today. Three steps are missing
from the middle: **auto GPS/timestamp watermarking**, **in-app annotation**, and
**repeatable sections**.

**Workflow 2 — Backend validation and distribution.** Effectively unstarted. The
KYPiT stage does not exist; the scoring stage runs *on the device* rather than on
the server and produces no flags, tasks or sign-off routing; the document stage
produces a browser print and nothing else. This whole workflow is what the
missing server tier is for.

---

## 11. Data schema and API (TRD §5)

The TRD's `VLX_Inspection_Submission` schema is a good target and QC2GO is
closer to it than the module tables suggest. Mapping what exists:

| TRD field | QC2GO equivalent |
| --- | --- |
| `inspection_id` | `Inspection.id` |
| `template_id`, `template_version` | `Inspection.templateId`, `snapshot.templateVersion` |
| `organization_id` | `org_id`, on every tenant-owned table |
| `site_metadata.site_id` | `Inspection.customerId` (customer, not site) |
| `site_metadata.scheduled_gps` | `Customer.location` — captured on arrival, not scheduled |
| `inspector.user_id` / `email` | `Inspection.createdBy` → `profiles` |
| `inspector.device_id` | **missing** |
| `kypit_verification.*` | **missing entirely** |
| `sections[].section_id` / `section_title` | `snapshot.sections[]` |
| `sections[].instance_index` | **missing** — this is the repeatable-sections gap in schema form |
| `sections[].score` | computed by `sectionProgress`, not stored |
| `fields[].field_id` / `field_type` / `value` | `responses{}` keyed by question id; `field_type` lives on the snapshot rather than the response |
| `fields[].flagged` | **missing** as a response-level flag (`critical` is a question property) |
| `media_attachments[].media_id` / `url` | `PhotoRecord.id` / `storagePath` |
| `media_attachments[].watermarked` / `gps` / `annotations` | **missing** |
| `summary.overall_score` / `pass_fail_status` | `inspections.overall_score` / `pass_fail_status`, written at sign-off (`0007`) |
| `summary.total_deficiencies` | `inspections.total_deficiencies`, written at sign-off (`0007`) |

Two structural notes worth acting on regardless of the rest:

1. ~~**Scores are computed, never stored.**~~ **Done in `0007`.** They still are
   computed on every read *inside* the app, which is right — the frozen snapshot
   sits beside the responses, so the number cannot drift from what the inspection
   said. But sign-off now writes `overall_score`, `pass_fail_status` and
   `total_deficiencies` down for everything that cannot run that code, using the
   same function that draws it on screen.
2. **Responses are a map, the TRD's are an array.** `Record<questionId, Response>`
   collapses cleanly into the TRD's `sections[].fields[]` shape at export time
   using the snapshot — no migration needed, just a serializer. Whoever writes
   the export should write it *to the TRD schema* rather than inventing a third
   shape.

None of the five `/v1` endpoints exist. `POST /v1/inspections/sync` is the one
QC2GO effectively already implements, in a different form: `src/lib/sync.ts`
drains an outbox straight into Postgres rather than posting a bulk payload.

---

## 12. What to build next

Ordered by value per unit of effort, with the dependency that gates each one.

**Tier 1 — no new infrastructure, direct field value**

1. **Photo annotation** (Module 2). The six-tool suite, or even the first three.
   Pure client-side canvas, no backend, and it lands straight in the
   customer-facing report. Biggest single improvement available today.
2. **GPS + timestamp watermark on capture** (Module 2/3). Read EXIF *before*
   `compressImage` re-encodes it, stamp coordinates and UTC time into the pixels,
   and store the coordinates on `PhotoRecord`. Unblocks photo geofencing later.
3. **Repeatable sections** (Module 1). Per head, per zone, per room. The
   business need is real today on ductless and multi-zone jobs, and it is the
   `instance_index` the TRD schema already assumes.
4. **Punch list view** (Module 4). Everything open across a customer's
   inspections, in one place, closable on a re-check. `deficiencies()`,
   `punch-recheck` and `Response.resolved` already exist — this is assembly.
5. **Reopen rationale + audit ledger** (Module 3/5). A required reason on
   unlock, written to an append-only table. Small, and it converts "locked by
   convention" into "locked by record".

**Tier 2 — needs the server tier (Supabase Edge Functions)**

6. **Webhook on `inspection.completed`** carrying the TRD payload. Forces the
   schema mapping in §11 to be written properly, and is the hook everything
   downstream hangs off.
7. **Server-rendered branded PDF**, replacing browser print as the customer
   deliverable. The company logo is already in place; what a server adds is
   consistent pagination and a file that does not depend on the browser's print
   dialog.
8. **Shared read-only report link** with expiry (Module 5). The one piece of
   third-party sharing customers will actually use.
9. **Excel/CSV export of results**, built on `inspection_summary`.

**Tier 3 — larger bets, in the TRD's spirit**

10. **Conditional logic** — even one level of if/then, which shortens every
    checklist for the scopes it does not apply to.
11. **Barcode/QR scanning** into serial-number checkpoints.
12. **Activity-velocity KYPiT signal** — the cheapest fraud check that matters
    for in-house crews, computable from data already stored.
13. **Tasks & work orders** with the TRD's six-state lifecycle, once punch lists
    have proven the assignment model.
14. **AI Scribe**, then **AI template generation**, then **AI Walkthroughs** —
    in that order of cost and risk.

**Deliberately not pursued** (revisit only if the app opens to outside
subcontractors): domain/WHOIS analytics, carrier lookup, VPN/Tor detection, the
1,000-template public library, and SOC 2 / SAML, which are procurement rather
than engineering.

---

## 13. Changes since this document was written

**`0004_organizations.sql` — multi-tenancy.** Item 13 of the roadmap above was
pulled to the front when the plan became to open QC2GO to other companies, on
the reasoning this document itself gave: cheap now, expensive after real data
exists. What landed, and what it changed in the tables above:

- Organizations, with `org_id` on every tenant-owned table and one company per
  account. Module 5 moved from ~40% to ~60%.
- Three roles rather than two, with `owner` able to invite.
- Invitation-based onboarding: a company is provisioned deliberately, its owner
  invites the rest.
- Every `using (true)` policy in the database replaced with a company
  comparison — including the photo bucket, whose read policy had admitted any
  signed-in caller to any object in it.
- A migration and isolation suite in CI that creates two companies and tries to
  cross between them.

**`0006_audit_log.sql` — reopening leaves a mark.** Unlocking a signed record
took no reason and wrote nothing anywhere, so a QC record could be amended with
no trace of who did it or why. It now needs a reason, shows it on the report, and
a trigger copies it into a ledger with no write policy of any kind.

The two-copy shape is the interesting part, and it comes from this app working
offline: the reason lands on the inspection so it can be written with no signal
and read anywhere, and the server keeps its own copy when the change syncs up.
The first is convenient; the second is the evidence.

**The invite flow — `invite-user` and Settings → People.** Provisioning a company
was a SQL statement and so was every account in it. An owner now invites staff
from inside the app: the Edge Function verifies them, writes the invitation and
sends the email; following the link signs the account in and asks for a password
before anything else.

Two things fell out of it worth recording:

- **PKCE, not the implicit auth flow.** Supabase's default returns the session in
  the URL fragment, which is the same fragment `HashRouter` uses for its routes.
  They collide, and an invitation link would either sign nobody in or navigate
  nowhere. PKCE returns `?code=` in the query string, which nothing competes for.
- **The service-role key needs a different kind of test.** Everywhere else a
  mistake is caught by a policy; the invite function has none underneath it. So
  its decision is a pure function with its own suite, whose central case is that
  a request body cannot name the company it is inviting into.

**`0005_branding.sql` — per-company letterhead.** The report was headed with a
per-device value each inspector typed in themselves, so one crew could hand out
reports headed three different ways. The name now comes from the organization,
with a logo beside it in a fixed slot that is reserved whether or not one has
been uploaded. Module 6's branded-PDF row moves from "no uploaded logo" to
"missing theming and presets".

It also turned up a bug left by `0004`: the profile — and with it the company,
the role and now the logo — was read from the server on every start, with no
cached copy. Opening the app offline would have shown a signed-in inspector the
"no company" screen and an empty app, which looks exactly like losing a day's
work. The profile is now cached on the device and the network answer replaces it
when one arrives.

Three problems it turned up on the way, each of which would have surfaced as a
production failure rather than an error:

1. **Checklist ids collided across companies.** The shipped checklists carry
   fixed ids from code, so every company seeds its own copies under the same
   ids. A global primary key meant the second company to sync got a unique
   violation — which the sync engine classifies as permanent, so the upload
   would have been abandoned and that company would silently have had no
   checklists. The key is now `(org_id, id)`.
2. **Record ids were eight hex characters.** Fine for one company; at platform
   scale that is a coin-flip collision by around 100k records, and a collision
   is the same permanent primary key violation. Ids now carry a whole UUID.
3. **Photo deletes chased files that never existed.** Queueing a delete computed
   a bucket path when the record had none — but a record with no `storagePath`
   was never uploaded. Now it queues the path only when there is one.
