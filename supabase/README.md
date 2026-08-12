# Supabase backend

Four migrations:

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

All four are replayed end-to-end from an empty PostgreSQL 16 database on every
pull request, along with a two-company isolation suite — see
[Proving the boundary](#proving-the-boundary). `0001` through `0003` are applied
to the live project; `0004` applies on merge.

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

Then invite its owner. Once an owner exists they invite the rest of their staff
themselves, and you are out of the loop:

```sql
insert into public.invites (org_id, email, role)
values ('<the org id>', 'owner@northeast-home.com', 'owner');
```

The person then signs up with that exact address under **Authentication →
Users** (or through an invitation email, once that is wired up). The signup
trigger reads the pending invitation, puts the new profile in that company with
that role, and marks the invitation accepted. **No invitation means no company** —
the account is created and sees nothing.

Invitations expire after 14 days, and only one can be live per address at a time
across the whole platform, since an account belongs to one company.

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

**`inspections.snapshot`** is the important one. Each inspection stores its own
frozen copy of the checklist — questions, sections, and info fields — as it stood
when the inspection began. An admin can reword a question or reorder a section
without altering a single signed record. Verified: after bumping a template to
version 2, the existing inspection still reports snapshot version 1.

**`photos`** indexes files in the private `inspection-photos` storage bucket,
keyed `<org_id>/<inspection_id>/<photo_id>.jpg`. The company comes first because
that is what the bucket policy reads — a caller may touch an object only when the
first path segment is their own company. Before `0004` the bucket had no tenancy
at all: the read policy admitted any signed-in caller to any object in it, so a
photo was one guessed path away from anybody with an account. The app reads
through signed URLs, so interior photos of customers' homes are never publicly
addressable either.

**`inspection_summary`** is one row per inspection with pass/fail/N-A counts
computed from the responses JSON — the view to point a dashboard or a Google
Sheets mirror at.

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

**Sending the invitation.** The invitation *mechanism* is complete — the row,
the expiry, the signup trigger that binds a new account to it. What is missing is
the part that emails a link and lets someone set a password from it. Supabase's
`inviteUserByEmail` needs the `service_role` key, which must never reach a
browser, so this needs an Edge Function. Until then an owner adds the invitation
row and the person is created under **Authentication → Users**.

**An owner-facing People screen.** Creating an invitation is a SQL statement
today. It should be a form, with the pending list beside it — the policies for
both are already in place.

**Per-company branding.** `settings.companyName` is still a per-device value that
each inspector types in, and it is what the printed report is headed with. It
should come from `organizations.name`, with a logo beside it.

**Storage cleanup for abandoned uploads.** A photo whose row upload fails after
the file has already gone to the bucket leaves the file behind. Rare, and it
costs storage rather than correctness, but there is no sweeper for it yet.

**Presence of other inspectors.** Nothing indicates that someone else is working
the same job right now; the first you know is when their inspection appears.
