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
| 1 — Template Builder & Field Types | **~65%** | Full section/checkpoint authoring with versioned snapshots, repeatable sections, and one level of conditional logic. Still 3 question types against the TRD's 15+, and no formulas. |
| 2 — Evidence Capture & Media | **~65%** | Photos captured, downscaled, stored offline and rendered into the report; marks drawn beside the image rather than burned into it; time, coordinates and inspector burned into the pixels; barcode capture into serial-number checkpoints on devices with a decoder. No video/audio, no Instacount, no AI, and no crop or rotate. |
| 3 — KYPiT Verification | **~35%** | The two signals that pay off against your own crews are built: completion velocity against an inspector's own pace, and photo coordinates against the job's. The rest of the risk engine — carrier lookup, WHOIS, VPN detection, image forensics — defends a door QC2GO does not have. |
| 4 — Scoring, Workflows & Automation | **~40%** | A real scoring model with critical-failure override and hard sign-off blockers. No tasks, no punch list, no approval chain, no triage queue. |
| 5 — Teams, Security & Access | **~70%** | Supabase auth, per-company tenancy with three roles, row-level security proven by an isolation suite, invitation-based onboarding, tombstoned deletes, and expiring read-only report links for people outside the company. No second (team) role layer, no SSO, and an audit ledger that records one action rather than all of them. |
| 6 — Reports, Exports & Integrations | **~40%** | Print-to-PDF report and JSON export; a Postgres summary view for the office. No branded layout engine, no .docx/.xlsx, no webhooks, no cloud sync. |

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
| — Barcode / QR (14 formats) | **Partial** | Four formats rather than fourteen — Code 128, Code 39, QR and DataMatrix, which is what appears on equipment data plates. A `scannable` flag rather than a fourth question kind: the QC question on a serial checkpoint is still a scored yes/no, and what was missing was anywhere to put the numbers. They land in `Response.value`, so they export and sync with nothing new having to learn about them. Reads on Android Chrome; an iPhone finds no decoder and the field stays hand-typed. |
| — Signature (geotagged, timestamped) | **Partial** | `SignatureRecord` carries name + `signedAt` (`src/lib/types.ts:144`). Not geotagged. |
| — Instacount | **Gap** | — |
| — Calculated fields (SUM/AVG/MIN/MAX) | **Gap** | Scores are computed (`scoreOf`, `src/lib/inspection.ts:257`) but there is no user-authored formula. |
| Conditional logic (if/then, nested, score-triggered) | **Partial** | One level: `showIf` on a section or a checkpoint, naming an earlier checkpoint and the answers that reveal it. Hidden blocks are not asked, not scored, not blockers, and not punch items — and the report lists them with the reason, so a skipped question and a deleted one do not look identical. Nested chains and score-triggered reveals are not built; the editor can only point a condition *backwards*, which is what makes a loop unauthorable. |
| Repeatable sections (per room / per zone / per head) | **Built** | A section marked repeatable runs once per instance, added on site and named by the inspector (`0012_repeatable_sections.sql`, `expandSections` in `src/lib/inspection.ts`). Each instance is answered and scored separately, so a failure names the head it belongs to. The TRD's `instance_index` has a home. |
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
| Image annotation — crop, rotate, annotate, text, highlight, freehand | **Partial** | Four of the six: **annotate** (arrow, box), **freehand**, and **text** with three severity colours (`src/components/PhotoAnnotator.tsx`). Stored beside the photo in normalised coordinates rather than burned in, so the evidence is untouched and the same mark lands identically on a phone, in the report and on paper. Crop and rotate are missing, and both are destructive in a way the others are not — worth deciding deliberately rather than adding for completeness. |
| Metadata watermarking (UTC time, GPS, inspector, inspection ID) | **Built** | See `src/lib/image.ts` and `src/lib/exif.ts`. |
| Barcode / QR scanning into mapped fields | **Partial** | `src/lib/barcode.ts` + `src/components/BarcodeScanner.tsx`. The scanner stays open after a hit and keeps reading, because a ductless job has a serial on the outdoor unit and one on every head. Repeats are suppressed, so holding the camera steady on one plate does not fill the field with forty copies of it. Blocked on iOS until a WebAssembly decoder is added — see §13. |
| Instacount visual counting | **Gap** | — |
| AI Walkthroughs (video/voice → mapped fields) | **Gap** | — |
| AI Scribe (grammar, tone, summarize) | **Gap** | Deficiency notes are typed raw. A narrow, cheap version — clean up one note on demand — is a strong early AI win because the note text goes straight to the customer. |
| Copy camera notes into template fields | **Partial** | `PhotoRecord.caption` exists in the model and round-trips through sync (`src/lib/syncMap.ts:164`) but is never set or shown in the UI. |
| Photos survive offline and sync later | **Built** | Beyond the TRD: photos are pulled as records and the bytes fetched lazily on first render (`supabase/README.md`, "Photos are pulled as records, not bytes"). |

---

## 5. Module 3 — KYPiT Verification & Audit Integrity

| TRD signal | Status | Note |
| --- | :---: | --- |
| Image signal — EXIF vs system time, geofence, AI-generation check | **Partial** | Geofencing is built (`src/lib/integrity.ts`): photos carry their own coordinates and are measured against the job's, flagged past a quarter-mile. The radius is deliberately generous — a fix taken in a basement is routinely a few hundred metres out, and a flag that fires on ordinary GPS error is one people learn to ignore. EXIF time is captured (`0009`) but not yet compared against the system clock. No AI-generation check. |
| User identity — carrier, email domain, behaviour profile | **Gap** | — |
| Domain analytics — WHOIS, MX, reputation | **Adapt** | Written for a platform accepting submissions from unknown contractors. QC2GO accounts are created by an administrator in the Supabase dashboard with no self-signup — the threat this defends against does not exist here. Skip unless the app is opened to subcontractors. |
| Activity analytics — completion velocity, step sequencing, reversions | **Partial** | Velocity is built. Median gap between consecutive answers, compared against that inspector's own history — with an absolute floor underneath, because an inspector who has always pencil-whipped has a fast baseline and a pure ratio would clear them forever. Step sequencing and reversions are not built. |
| IP analytics — ISP, VPN/Tor, mock location | **Gap** | — |
| Risk score + flag routing to a review queue | **Gap** | — |
| Immutable record after sign-off | **Partial** | A completed inspection is read-only in the app (`src/screens/InspectionScreen.tsx:78`) and the server refuses edits to a completed record except by an admin (`inspections_update_own_open` policy). But "Reopen for editing" (`src/screens/ReportScreen.tsx:59`) takes **no rationale**, and nothing is written to an audit ledger. The TRD requires both. This is a small, high-integrity fix. |

**Honest read:** the two pieces worth having are now built, and the rest is
still not worth buying. Velocity and geofencing cost one pure module over data
the app already stored. Carrier lookup, WHOIS, VPN detection and generative-AI
image forensics are third-party-vendor purchases that only pay off against
adversarial *external* submitters, and QC2GO accounts are created by invitation
with no self-signup.

The design constraint that mattered was credibility rather than coverage. A
fraud flag is only worth having if a supervisor still reads it in six months, and
every false positive spends that down — so most of `check:integrity` is about
what must *not* fire: a three-question re-check, a record left open overnight, a
walk interrupted by lunch, a fix taken in a basement, an inspector who is simply
quick. Nothing is stored on the inspection either; flags are derived on read, so
a threshold can be improved without rewriting signed records and a heuristic that
turns out to be wrong has not stamped a permanent accusation onto a QC document.

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
| Third-party sharing — Assignee / Collaborator / Viewer, secure link over email/SMS, expiry, passcode | **Partial** | The Viewer tier is built (`0013_report_shares.sql`): a read-only link to a signed report, openable with no account, 30-day expiry, optional passcode, revocable by anybody in the company, with a view count. Tokens are stored hashed, so the link is shown once and cannot be recovered. Assignee and Collaborator are not built — they imply outside accounts writing into a company's records, which is a different product. QC2GO does not send the link; the sender pastes it wherever they already talk to the customer. |
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
| Excel exports (raw / pivot / summary) | **Built** | JSON export only (`ReportScreen.exportJson`). `docs/checklists.csv` is a CSV of *checklist definitions*, not results. The Postgres view `inspection_summary` (`supabase/migrations/0002_customers.sql:97`) already flattens pass/fail counts per inspection and is one step from a real office spreadsheet. |
| REST API & webhooks (`inspection.created/completed`, `task.flagged`) | **Gap** | Supabase exposes PostgREST over the tables, but none of the TRD's `/v1` contract exists and nothing fires on completion. |
| Cloud storage auto-sync (Drive / Dropbox / OneDrive / SharePoint, `/Client/Project/Year/`) | **Gap** | — |
| BI connectors (Power BI, Looker Studio, Metabase) | **Partial** | Any of them can point at Postgres today; `inspection_summary` is a usable starting view. No curated dataset or dashboard. |

---

## 9. UI/UX blueprints (TRD §3)

| Layout | Status | Note |
| --- | :---: | --- |
| 1 — Template Builder Web Canvas | **Partial** | `ChecklistEditorScreen` covers the centre canvas. No left field palette (there are only three question kinds to drag) and no right inspector panel (properties are inline). Both arrive naturally with more field types. |
| 2 — Mobile Field Inspection | **Built** | The closest match in the app. Offline badge (`OfflineBanner`), progress metrics, one-tap Yes/No/N-A tiles, inline Add Photo, sticky bottom bar. Missing from the TRD's bar: flag navigation and voice dictation. |
| 3 — Mobile Evidence & Camera Annotator | **Partial** | Built since this table was first written: `0010` added arrow, box, circle, freehand and text marks in normalised coordinates, and `0009` burns the time, coordinates and inspector into the pixels. Still missing: a capture-mode toggle, and the TRD's blur and measurement tools. |
| 4 — Report Generation & Layout Engine | **Partial** | Report preview, download and a read-only share link exist; no preset switcher and no email — QC2GO produces the link, the sender delivers it. |
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
| `sections[].instance_index` | `inspections.section_instances`, with answers keyed `<questionId>#<instanceId>` |
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

**`0012_repeatable_sections.sql` — sections that run once per thing.** The gap
this document called the most costly in Module 1. A section can be marked
repeatable and the inspector adds one instance per head, zone or room on the job.

The decision that mattered was keying. Answers stay in the same flat map, keyed
`<questionId>#<instanceId>` inside a repeatable section and by bare question id
everywhere else — a composite key rather than a nested map, precisely so that
every inspection signed before today still reads exactly as it did. A signed
report quietly turning blank is the worst outcome available, and it is the first
thing the new suite asserts.

`expandSections` is the other half: every aggregate — progress, score, blockers,
deficiencies, punch, export, report — iterates the expanded view rather than the
raw sections, so they became instance-aware without each of them learning what an
instance is.

**The office export.** Two CSVs from the Completed screen: one row per
inspection, and one row per checkpoint for pivoting on which questions fail most
often. Built from local data, so it works with no signal.

The interesting part was the encoding rather than the rows. Excel executes a
field that begins with `=`, `+`, `-` or `@`, and a measurement of `-2` is
ordinary in this app — so every such value is neutralised on the way into the
file. Without a byte-order mark Excel also reads UTF-8 as Latin-1 and turns every
`°` into mojibake. Both are asserted, along with a comma in an address and a
quote in a name.

It also turned up a real bug in the existing JSON export: the download anchor was
never attached to the document, which works in some browsers and is silently
ignored in others — no file, no error, nothing to report. Both exports now share
one helper that appends, clicks and cleans up.

**`sweep-photos` — collecting files nothing points at.** Housekeeping, and the
last item carried over from `supabase/README.md`'s "Still to build". Bytes go to
the bucket before the row that makes them findable, so a row upload that fails
after the file has landed leaves the file behind — invisible to the app and
costing storage forever.

It is worth recording *why* this one is written the way it is. It is the only
code in QC2GO that destroys evidence: no undo, no second copy on the server, and
a bug here does not produce a wrong number on a screen but removes the
photographic record of a job somebody may need in a warranty dispute two years
from now. So the decision is a pure function with four guards, each for a
specific way it goes wrong.

**A failed lookup is not an empty one.** This is the catastrophic bug this
feature could have shipped with: a transient database error reading as "no
photos exist" makes every file in the bucket an orphan. The two answers are
different *types* here — `{ ok: false, reason }` versus a set of paths — because
a type that cannot express the difference is one that will eventually make it.

**Anything recent is left alone**, for seven days. A photo being uploaded right
now has no row yet by definition, and an outbox entry retries with backoff on a
device that can be offline for days.

**A bucket that looks mostly orphaned is refused.** A renamed column, a changed
path format or a half-read result set all present as a suspiciously high orphan
rate rather than as an error. A genuine orphan rate is a rounding error. The
check is skipped below twenty aged objects, though — one orphan in a bucket of
two is 50% and perfectly ordinary, and a safety valve that never opens for a
small company is a wall rather than a valve.

**One run deletes at most 500**, and reports how many it held back, so a mistake
that gets past all of the above is bounded and visible before it is total.

**Pencil-whipping checks.** Roadmap item 12, and the two pieces of Module 3 worth
building for a company running its own crews. A 60-checkpoint inspection answered
in ninety seconds was not walked; a photograph taken twelve miles from the job is
not evidence of the job. Both were computable from data already on the device.

**Median gap between answers, not elapsed time.** An inspection left open on a
phone overnight has an enormous duration and says nothing, and a walk interrupted
by lunch has one huge gap that would drag a mean upward and hide exactly the
pattern being looked for. A median does not notice the interruption at all.

**Compared against the inspector's own pace — with a floor underneath.** Crews
differ and scopes differ, so a company-wide average would flag the fast people
every week. But a ratio alone has a hole: an inspector who has *always*
pencil-whipped has a fast baseline, and comparing them to themselves clears them
forever. The threshold is the larger of the two, so somebody whose normal is a
minute per checkpoint is flagged at twenty seconds, somebody genuinely quick is
not flagged for being quick, and nobody is cleared by their own bad history.

**The design constraint was credibility, not coverage.** A fraud flag is only
worth having if a supervisor still reads it in six months, and every false
positive spends that down. So most of `check:integrity` is about what must *not*
fire: a three-question re-check, a record left open overnight, a walk interrupted
by lunch, a fix taken in a basement, a photo with no coordinates, a customer
whose location was never captured, an inspection signed before `answeredAt`
existed. The geofence radius is a generous quarter-mile for the same reason.

**Nothing is written to the inspection.** Flags are derived on read, so a
threshold can be improved without rewriting a single signed record — and a
heuristic that turns out to be wrong has not stamped a permanent accusation onto
a QC document. They are also admin-only and never printed: telling the person
being measured where the line sits is how you teach them to pace just above it,
and a supervisor's prompt has no business on the copy handed to a customer.

**Conditional logic — asking only what applies.** Roadmap item 10. A section or
a checkpoint can now carry `showIf`, naming an earlier checkpoint and the answers
that reveal it. Twelve combustion questions no longer get answered N/A on an
all-electric job.

The whole feature went in at `expandSections` — the seam repeatable sections
established — so progress, score, blockers, deficiencies, punch, export and the
report became condition-aware without any of them learning what a condition is.
The filter is deliberately idempotent and applied in both `expandSections` and
`visibleQuestions`, so it cannot matter whether a caller hands over a raw section
or one that has already been through it. A rule this important is worth being
unable to skip.

Three things were less obvious than the branching itself:

**A hidden question must not count.** Not in the score, not as a punch item, and
above all not as a sign-off blocker — a blocker naming a checkpoint that is
nowhere on screen cannot be cleared by anybody, and no amount of scrolling
explains it. That is the first thing the new suite asserts, and the guard is
paired with its opposite: a *visible* question must still block, so the fix
cannot have been bought by making blockers toothless.

**Hiding is not deleting.** An inspector who answers a block, corrects the
controlling answer, and corrects it back should not have lost the work in
between. Answers left behind by a hidden block stay on the record and simply stop
being read.

**Routing questions needed their own idea.** This is the part the issue did not
anticipate. "Gas-fired appliance on site" is the shape of question a condition
hangs off, and in this app answering a yes/no checkpoint No means a deficiency —
so every electric job would have scored a failure, demanded a photograph of the
absent appliance, and refused to be signed until somebody explained why there
wasn't one. Hence `informational`: asked and answered like any checkpoint, still
required before sign-off (a forgotten router silently skips everything downstream
of it), never scored, never a punch item, and shown with a muted mark on the
report rather than a red cross. `isScored` and the new `isYesNo` had to be
separated to express it — one is about how a question is answered, the other
about whether it counts.

**And the report has to explain itself.** A conditional block that simply
vanishes leaves a record nobody can audit: a year later, a question skipped
because it did not apply and one quietly dropped from the checklist look
identical — absent. So the report carries a "Not applicable to this job" section
naming each one and the answer that hid it, read from the inspection's own frozen
snapshot like everything else on a signed record.

Nested chains and score-triggered reveals are deliberately not built. The editor
can only point a condition *backwards* — at checkpoints earlier in the checklist
— which is what makes a loop unauthorable rather than merely discouraged.

**Barcode capture into serial checkpoints.** Roadmap item 11. Reading a serial
off a data plate with the camera instead of gloved thumbs.

The finding that reframed this one: serial numbers were not being typed by hand
into a field, because **there was no field**. `u-serials` and `q-serials` are
yes/no checkpoints with a required photo, so the only place a serial existed was
as pixels inside a photograph — unsearchable, absent from the spreadsheet and the
webhook payload, and useless for a warranty registration without somebody
squinting at an image. Scanning was the smaller half of the work; giving the
numbers somewhere to live was the larger.

They live in `Response.value`, the field a measurement already uses, reached by a
`scannable` flag on the question rather than a fourth question kind. That keeps
the QC question scored as the yes/no it has always been ("were they recorded and
photographed?"), needs no migration because `responses` is a JSON document, and
means the export, the sync mappers and the payload carried them the day the flag
was added without any of them learning what a serial is.

Two things about scanning are worth knowing:

**The scanner does not close on the first hit.** A ductless job has a serial on
the outdoor unit and one on every head, and an inspector who has already climbed
behind the condenser should get all of them in one go. Which means the detect
loop reports the same plate several times a second — so `mergeCodes` suppresses
repeats, and does it in a pure function that is tested without a camera. Without
it, one steady hand produces forty copies of one serial.

**Control characters are stripped.** Code 128 carries FNC1 and friends, which
decode to unprintables. Stored, they sit invisibly inside a serial that looks
exactly right on screen while every comparison against the manufacturer's records
fails. That is the kind of bug that is never found, only worked around.

**It does not work on iPhones, deliberately.** `BarcodeDetector` is in Chrome on
Android and absent from Safari with no sign of arriving. The fallback is a
WebAssembly decoder — a few hundred kilobytes every device would carry offline —
and that is not worth adding before we know what the crews hold in their hands.
`findEngine` is the only function that knows what decodes, so adding it later is
one function and nothing above it changes. Until then the scan button is simply
never drawn on a device that cannot scan, rather than drawn and broken.

**`0013_report_shares.sql` — a link you can send a homeowner.** Roadmap item 8.
Until now a finished report left the app as a printed PDF or a JSON file; there
was no way to send one. A signed report now produces a link that opens with no
account, lasts 30 days, takes an optional passcode, and can be revoked by anybody
in the company.

Three decisions carried the design:

**The token is stored hashed.** A share token is a bearer credential — whoever
holds the link reads the report. Storing them in plaintext means a leaked backup
or one over-broad policy hands over every live share at once. A SHA-256 is
useless to a reader of the table and exactly as useful to the function checking
one, which is the reasoning applied to passwords everywhere else. The cost is
that the link is shown once and cannot be recovered, which is the right way
round: a lost link costs two taps, a leaked table costs every report in it.

**Refusals are deliberately indistinguishable.** An unknown token and an expired
one give byte-identical answers. Telling them apart lets somebody working through
guesses learn which were once real, and no legitimate reader does anything with
the difference.

**A reopened report goes dark.** A signed report can be unlocked and amended, and
while it is open it is a working draft — half-corrected answers, a cleared score.
A link handed out last week must not start showing that. It returns a "being
updated" state rather than the draft, and the same link works again once the
record is signed off. Revoking on reopen would have been the easier
implementation and the wrong one: the link is not compromised, the record is
merely mid-edit.

The function serving this is the second one to run with the service key, which
means row-level security is not underneath it. As with `invite-user`, every
reason to refuse and every field a reader may see live in one pure module
(`access.ts`) so both can be asserted — `npm run check:share-access`, in CI. What
a reader gets is an allow-list rather than a set of deleted fields, so a column
added to `inspections` next year is invisible here by default rather than
disclosed by default. `created_by`, `org_id`, the internal ids and the reopening
history are all deliberately absent, and photos travel as short-lived signed URLs
rather than bucket keys.

It also turned up a routing bug worth recording. The exemption that lets this one
route past the sign-in gate read `window.location.hash` directly, and `App` does
not re-render on a location change unless it consumes the router's location.
Moving between two hashes of the same document is not a page load — so following
a share link from a tab that already had QC2GO open showed the sign-in screen
with no way past it, while the same link opened cold worked perfectly. The
auth-gate suite caught it only because it arrives at the share route from a gated
screen rather than from a fresh load; it now checks both.

**`0011_webhooks.sql` — the first thing out of the building.** Completed
inspections now reach other systems. Two decisions worth recording: the payload
is built at the moment of completion and stored, so a retry an hour later sends
the body it was always going to send rather than re-reading a record that may
have been reopened since; and deliveries are a queue with backoff rather than
fire-and-forget, because an event lost to somebody's server restarting is worse
than no integration at all.

It also settles the §11 note about the payload mapping: the serializer was
written to the TRD's shape rather than to a third shape of our own, which is what
the export in #25 will reuse.

**`0010_annotations.sql` — marks on a photo.** Four of the TRD's six annotation
tools, stored as coordinates beside the photo rather than burned into it. Two
consequences worth recording: the original evidence is never altered, and the
same mark renders identically at thumbnail, full screen and print size because
every coordinate is a fraction of the image rather than a pixel.

Freehand strokes are simplified with Ramer–Douglas–Peucker rather than by
spacing. Distance thinning throws away half the points of a straight line and
keeps the other half, all of which say the same nothing; what makes a point worth
keeping is that the stroke *turns* there.

**`0009_photo_provenance.sql` — photos say where they came from.** This document
flagged that `compressImage` re-encodes through a canvas and so destroys EXIF,
leaving a QC2GO photo with *less* provenance than the raw camera file. Metadata
is now read off the untouched file first, kept as columns, and burned into the
pixels — because metadata does not survive a photo being exported to a PDF,
printed or emailed on, which is most of how these are looked at.

Two things fell out of it that were not the feature:

- **A production bug in `vercel.json`.** `Permissions-Policy: geolocation=()`
  denies geolocation to *every* origin including this one, so "Use my location"
  and "Near me" were silently broken on every deployment while working perfectly
  on localhost, where no header is served. Worse, the browser reports it as the
  *user* denying permission, so the app's advice on screen was to grant a
  permission that would never have helped. Fixed, and `check:vercel` now refuses
  a policy that denies a feature the app uses.
- **A test fixture that disabled the code it was testing.** The smoke suite's
  PNG had a corrupt IDAT chunk — bad CRC, would not inflate. The app falls back
  to storing the original file when an image cannot be decoded, so every photo
  assertion passed while the downscale path was never once executed. Replaced
  with a PNG the script builds itself.

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
