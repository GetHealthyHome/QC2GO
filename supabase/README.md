# Supabase backend

Nine migrations:

- **`0001_init.sql`** — tables, roles, row-level security, the photo storage
  bucket, and an office summary view.
- **`0002_customers.sql`** — renames `jobs` to `customers` and brings the schema
  in line with the app's model: no job name, job notes became the work scope, a
  customer carries its checklist ids and the GPS point captured on site, and an
  inspection carries the visit date it covers.
- **`0003_sync.sql`** — what the sync layer needs: somewhere to keep the
  salesperson and team-leader pick lists, tombstones so a delete on one device
  reaches another, and the indexes a pull actually reads.
- **`0004_organizations.sql`** — the tenancy boundary. Companies, one company
  per account, and every policy in the database narrowed from "is this person
  signed in?" to "is this row theirs?".
- **`0005_branding.sql`** — the company logo, so a report carries the mark of the
  company handing it over.
- **`0006_audit_log.sql`** — an append-only ledger, and the reason a signed
  inspection was unlocked.
- **`0007_stored_scores.sql`** — the result written down at sign-off, for
  everything outside the app that cannot derive it.
- **`0008_punch_resolutions.sql`** — closing out a punch item, recorded without
  touching the inspection that raised it.
- **`0009_photo_provenance.sql`** — when and where a photo was actually taken.

All nine are replayed end-to-end from an empty PostgreSQL 16 database on every
pull request, along with a two-company isolation suite — see
[Proving the boundary](#proving-the-boundary). `0001` through `0004` are applied
to the live project; `0005` through `0009` apply on merge.

## Setting it up

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the migrations in order, or with the CLI:
   `supabase link --project-ref <ref> && supabase db push`.
3. Under **Authentication → Providers**, confirm **Email** is enabled. Turn off
   "Confirm email" only if inspectors will be onboarded by hand.
4. Create the first company and its owner — see
   [Adding a company](#adding-a-company) below.
5. From **Project Settings → API**, note the project URL and the publishable
   (anon) key. Those are the two values the app will need.

Do not rename the migration files. The GitHub integration records each applied
version by filename; renaming `0001_init.sql` would make it look unapplied and it
would re-run against types that already exist.

## Organizations

Every row belongs to a company, and an account belongs to exactly one. That one
value — `profiles.org_id` — is the whole tenancy boundary: every policy in the
database is a comparison against it, and `current_org_id()` is the only thing any
of them needs to know.

It is deliberately a single scalar rather than a join. A join in a policy is a
place for a mistake to hide, and a mistake here is one company reading another's
inspection records.

**One company per account.** An inspector works for one company. Somebody who
needs to be in two needs two accounts, which is the honest representation of the
situation anyway. Moving to a memberships table later is mechanical; every policy
would swap one comparison for one `in (...)`.

**An account with no company sees nothing.** `org_id` is nullable, and every
policy compares against it — so for an uninvited account every comparison is
null, every table comes back empty, and the app says so on its own screen rather
than looking broken. That is the direction this fails in by design.

### Roles

| Role | Can |
| --- | --- |
| `owner` | Everything an admin can, plus inviting people and renaming the company. |
| `admin` | Author checklists, amend signed records, delete customers. |
| `inspector` | Run inspections, read every report in their own company. |

`owner` never appears in the app's local role picker: the rights it carries are
over other people's accounts, so it can only arrive from a signed-in profile.

### Adding a company

There is no self-serve signup — a company is created deliberately, in SQL:

```sql
insert into public.organizations (name, slug)
values ('Northeast Home Services', 'northeast-home')
returning id;
```

Then invite its owner:

```sql
insert into public.invites (org_id, email, role)
values ('<the org id>', 'owner@northeast-home.com', 'owner');
```

and create the account with that exact address under **Authentication → Users**.

**That is the only step you take.** From there the owner invites the rest of
their staff from **Settings → People** inside the app, and you are out of the
loop entirely.

### How an invitation works

An owner enters an address and a role. The `invite-user` Edge Function writes the
`invites` row and sends the email; following the link signs the account in and
the app asks for a password before anything else.

The signup trigger is what binds the two together: it reads any live invitation
for the new address, puts the profile in that company with that role, and marks
the invitation accepted. **No invitation means no company** — the account is
created and sees nothing, which is the safe direction to fail in.

Invitations expire after 14 days, and only one can be live per address at a time
across the whole platform, since an account belongs to one company. An expired
one is cleared out when the same address is invited again, rather than reported
as a conflict nobody can resolve.

## Edge Functions

`supabase/functions/` holds the server-side code. There is one function today.

### `invite-user`

The only part of QC2GO that runs with the `service_role` key — it needs the
admin API to send an invitation email, and that key bypasses row-level security
entirely. It must never reach a browser, which is why this runs on a server and
the client only asks.

Because the key bypasses RLS, nothing underneath the function catches a mistake
in it. Two habits guard against that:

1. **The caller is read back with their own token**, not the service key, so who
   they are and which company they are in is answered by the same policies that
   answer it everywhere else.
2. **The decision is a pure function** (`invite-user/authorize.ts`), tested
   directly by `npm run check:invite-authorization` — including the case that
   matters most, which is that a request body cannot name the company it is
   inviting into. The organization always comes from the caller's own profile
   row; a company named in a request is a claim with nothing behind it.

Deploy it, and set where its invitation links should land:

```bash
supabase functions deploy invite-user
supabase secrets set QC2GO_SITE_URL=https://your-deployment.vercel.app
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
to the function automatically.

Without `QC2GO_SITE_URL` the invitation link points at Supabase's own default and
the person never reaches the app.

### One thing to check in the dashboard

Under **Authentication → URL Configuration**, add the deployment origin to
**Redirect URLs**. Supabase refuses to redirect anywhere not on that list, and
the failure looks like an invitation link that simply does not work.

### Branding

`organizations.logo` holds the company logo as an image data URL, and only an
owner can set it — the same `organizations_owner_update` policy that governs the
company name.

Storing an image inline rather than in a storage bucket is a deliberate trade
against the usual advice, for one reason: **this app prints reports in
crawlspaces**. A bucket object needs a signed URL and a network round trip to
render, which is exactly what is missing at the moment the report is produced.
The organization travels with the profile at sign-in and is cached on the device,
so a data URL is on hand offline and a bucket object is not.

The cost is a fat column, bounded by check constraints at 512 KB and to
`data:image/%`. The client downscales to the report's slot before encoding, so a
real logo lands far under that; anything approaching the ceiling is a bug or an
abuse. One logo per company is nothing beside the thirty-odd photos a single
inspection carries.

### Proving the boundary

`npm run check:migrations` applies every migration to a throwaway PostgreSQL and
then attempts, as one company, to read and write another's data — customers,
inspections, the user roster, the shared config, tombstones, and the photo
bucket. It also replays the path the live database will actually take: three
migrations, a company's worth of data, then the fourth, checking the data was
adopted rather than orphaned and that photo objects and the rows pointing at them
moved together.

This is the one kind of code where "it compiles" and "it is correct" are
furthest apart. A policy with a typo installs fine. A policy that admits every
signed-in caller installs fine. CI runs this on every pull request.

## How the schema is shaped

**`profiles`** extends `auth.users` with a company (`org_id`) and a `role` of
`owner`, `admin`, or `inspector`. A trigger creates the row on signup, reading
both from any pending invitation for that address, so promotion is
always a deliberate act. Policies read the role through
`current_role_is_admin()`, a `security definer` function — reading `profiles`
directly from inside a `profiles` policy would recurse.

**`customers`** is the organizing record — one project per customer. Every visit,
every checklist and every QC card hangs off it. `template_ids` is the set of
checklists chosen when the record was created; `location` is the GPS point
captured while standing at the property, which is what "projects near me" reads.
Addresses are never geocoded, so there is no network call on that path.

**`templates`** and **`shared_config`** hold the checklists. Everyone in the
company reads them; only its admins write. Both are keyed by company:
`shared_config` has one row per organization, and a checklist's primary key is
`(org_id, id)` rather than `id` alone. That last one matters more than it looks —
the shipped checklists carry fixed ids from code, so every company seeds its own
copies under the same ids, and a global key would give the second company to sync
a unique violation. The sync engine treats that as permanent, so the upload would
be abandoned and the company would silently have no checklists.

`inspections.template_id` carries no foreign key. The snapshot is the real
identity of the checklist, and the constraint was doing active harm: the sync
engine had to null the column out whenever a checklist had not reached the server
yet, purely to stop inspections failing to upload behind it.

**`customers.punch_resolutions`** records punch items corrected on a later
visit, keyed `<inspection_id>:<question_id>`. The obvious home for this — a flag
on the response inside the inspection — is the one place it must not go. A signed
inspection is a record, and quietly rewriting a response inside one to say
"fixed" would walk through every guarantee the app makes about that, invisibly:
the reopen trigger only fires on a status change, so nothing would notice.

A resolution is a new fact rather than an edit of an old one, and the customer is
where it belongs on its own merits — the punch list is a per-customer view
spanning every inspection, so its state sits at that level.

**`inspections.snapshot`** is the important one. Each inspection stores its own
frozen copy of the checklist — questions, sections, and info fields — as it stood
when the inspection began. An admin can reword a question or reorder a section
without altering a single signed record. Verified: after bumping a template to
version 2, the existing inspection still reports snapshot version 1.

**`photos.taken_at` / `gps` / `gps_source`** are where the photo says it came
from. `created_at` is when the record was made on the device; `taken_at` is when
the shutter fired, and the two are occasionally days apart — a photo picked out
of the camera roll rather than taken on site is exactly the case worth being able
to see. `gps_source` separates the camera's claim about the photo from this
device's position when it was saved; they answer slightly different questions and
one is far easier to fake.

**`photos`** indexes files in the private `inspection-photos` storage bucket,
keyed `<org_id>/<inspection_id>/<photo_id>.jpg`. The company comes first because
that is what the bucket policy reads — a caller may touch an object only when the
first path segment is their own company. Before `0004` the bucket had no tenancy
at all: the read policy admitted any signed-in caller to any object in it, so a
photo was one guessed path away from anybody with an account. The app reads
through signed URLs, so interior photos of customers' homes are never publicly
addressable either.

**`inspections.overall_score`, `pass_fail_status`, `total_deficiencies`** are the
result, written once at sign-off and null until then. Inside the app the score is
still derived from the responses on every read, which is right: the frozen
snapshot sits beside them, so the number cannot drift from what the inspection
said. These exist for everything that cannot run that code — a webhook body, a
spreadsheet export, a dashboard. Both are produced by the same function, so there
is one rule rather than two implementations free to disagree.

Reopening a signed record clears them. A verdict belongs to the sign-off that
produced it, and a reopened inspection does not have one.

**`inspection_summary`** is one row per inspection — the view to point a
dashboard or a Google Sheets mirror at. It reports the stored result and keeps
the raw pass/fail/N-A counts beside it. It used to derive pass and fail itself,
which quietly made it a second implementation of the scoring rule.

**`audit_log`** is where a signed inspection being unlocked is recorded. It is
append-only in the strongest sense the database offers: there is a select policy
and **no insert, update or delete policy at all**, so the only thing that can add
a row is a `security definer` trigger and nothing whatsoever can change or remove
one.

The reason itself is captured twice on purpose. `inspections.reopenings` holds it
on the record — writable offline, carried by the ordinary sync, and shown on the
report wherever it is read. The trigger copies each new entry into the ledger
when the change reaches the server. The first copy is the convenient one and the
second is the evidence.

**`tombstones`** records what was deleted, so a device that was offline at the
time finds out. Readable inside the company that owns the deleted row and
writable by nobody: the rows are written by a `security definer` trigger, and
there is deliberately no insert policy. The marker carries its company for the
same reason everything else does — an id on its own would tell one company the
identifiers of another's deleted records.

## Who can do what

Everything below is scoped to the reader's own company first. "Every" means
every one in that company, and there is no row anywhere that means every one in
the platform.

| | Inspector | Admin | Owner |
| --- | --- | --- | --- |
| Run inspections | ✅ | ✅ | ✅ |
| Read every completed report | ✅ | ✅ | ✅ |
| Create and edit customers | ✅ | ✅ | ✅ |
| Edit an inspection | own, while in progress | any | any |
| Reopen a signed inspection | ❌ | ✅ | ✅ |
| Create and edit checklists | ❌ | ✅ | ✅ |
| Delete customers | ❌ | ✅ | ✅ |
| Change roles | ❌ | ✅ | ✅ |
| Invite people | ❌ | see who is pending | ✅ |
| Rename the company | ❌ | ❌ | ✅ |
| See anything in another company | ❌ | ❌ | ❌ |

Inspectors read all their company's reports on purpose — recalling someone
else's past walkthrough on a return visit is a real need. Tighten
`inspections_select` if you want that scoped further.

## Linter warnings left standing

Supabase's database linter flags `current_role_is_admin()` and
`handle_new_user()` as `SECURITY DEFINER` functions reachable over the REST API.
Both are left as they are, deliberately:

- `current_role_is_admin()` takes no arguments and reports whether *you* are an
  admin. Revoking `execute` from `authenticated` would break every policy that
  calls it — a policy expression is evaluated with the caller's privileges, so
  the whole app would start returning permission errors.
- `handle_new_user()` returns `trigger`. PostgreSQL refuses to call a trigger
  function directly, so there is nothing to invoke. Touching its grants risks the
  signup path for no gain.
- `record_tombstone()` in `0003` is the same case: `security definer` so the
  marker is written by the trigger rather than by the caller, and `trigger`
  returning, so it cannot be invoked directly either. That is what lets the
  tombstones table have no insert policy at all.

`touch_updated_at()` was the one worth fixing — `0002` pins its `search_path`.

## Connecting the app

Set both variables wherever the app is built — Vercel → Settings → Environment
Variables, plus a local `.env` for development:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Both come from **Project Settings → API**. Use the publishable key only.

With them set, every route sits behind a sign-in, the role comes from
`profiles.role`, and sync starts under that account. Without them the app runs
local-only, shows a Local mode banner, and the outbox is never written to.

## How sync works

IndexedDB is still the write path. An inspector in a crawlspace has to be able to
answer a question, take a photo and sign off with no signal at all, so nothing
ever waits on the network. A local write lands immediately and leaves a note in
an outbox; the engine in `src/lib/sync.ts` drains that outbox whenever there is a
connection and a signed-in account, then pulls back whatever changed elsewhere.

It runs on reconnect, when the tab becomes visible, every five minutes, and a
second or so after a change. Settings shows what is pending.

**Outbox entries are keyed `<entity>:<id>`**, so answering the same question
eight times collapses to one upload instead of eight.

**Pushes go in dependency order** — checklist, customer, inspection, photo —
because the foreign keys mean an inspection cannot arrive before the customer it
belongs to. An inspection whose checklist is not on the server uploads with a
null `template_id` rather than failing; the frozen snapshot still names the
checklist, and that is what reports read.

**Conflicts resolve last-write-wins.** Two people editing one record at the same
moment is not a real scenario here — one person walks one job. The exception is a
signed inspection, and that is handled by the server rather than by trust: the
`inspections_update_own_open` policy refuses any edit to a completed record
except by an admin, so a stale device cannot overwrite a signed report. A refused
change is kept and surfaced in Settings, not dropped silently.

**Deletes travel as tombstones.** A pull asks "what changed since I last
looked?", and a row that no longer exists cannot answer. Every delete leaves a
marker, written by trigger rather than by the client — so cascades are caught
too, and a device cannot forge one and make another device drop data.

**Photos are pulled as records, not bytes.** They are by far the heaviest thing
here, so the file is fetched the first time something renders it and cached
locally after that. Deleting a customer cascades the rows server-side but not the
files, so the bucket keys are collected before the local records go.

**The pull watermark is kept per table**, and only ever advances to a timestamp
the server itself returned. A single shared watermark taken from whichever table
answered first could skip past rows another was still writing, and a device whose
clock ran fast would skip rows it had never seen.

`npm run check:sync-mappers` round-trips every record through its database row
and back. A column renamed in a migration but not in `src/lib/syncMap.ts` is not
a type error — the field simply arrives back empty — and this is what catches it.

## Still to build

**Storage cleanup for abandoned uploads.** A photo whose row upload fails after
the file has already gone to the bucket leaves the file behind. Rare, and it
costs storage rather than correctness, but there is no sweeper for it yet.

**Presence of other inspectors.** Nothing indicates that someone else is working
the same job right now; the first you know is when their inspection appears.
