# Supabase backend

Three migrations:

- **`0001_init.sql`** — tables, roles, row-level security, the photo storage
  bucket, and an office summary view.
- **`0002_customers.sql`** — renames `jobs` to `customers` and brings the schema
  in line with the app's model: no job name, job notes became the work scope, a
  customer carries its checklist ids and the GPS point captured on site, and an
  inspection carries the visit date it covers.
- **`0003_sync.sql`** — what the sync layer needs: somewhere to keep the
  salesperson and team-leader pick lists, tombstones so a delete on one device
  reaches another, and the indexes a pull actually reads.

All three have been replayed end-to-end from an empty PostgreSQL 16 database.
`0001` and `0002` are applied to the live project; `0003` applies on merge.

## Setting it up

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the migrations in order, or with the CLI:
   `supabase link --project-ref <ref> && supabase db push`.
3. Under **Authentication → Providers**, confirm **Email** is enabled. Turn off
   "Confirm email" only if inspectors will be onboarded by hand.
4. Invite users under **Authentication → Users**. Everyone lands as an
   `inspector`. Promote yourself:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

   Until at least one account exists, there is nothing to sign in with — the
   sign-in screen will keep rejecting credentials because no user matches them.

5. From **Project Settings → API**, note the project URL and the publishable
   (anon) key. Those are the two values the app will need.

Do not rename the migration files. The GitHub integration records each applied
version by filename; renaming `0001_init.sql` would make it look unapplied and it
would re-run against types that already exist.

## How the schema is shaped

**`profiles`** extends `auth.users` with a `role` of `admin` or `inspector`. A
trigger creates the row on signup, defaulting to `inspector`, so promotion is
always a deliberate act. Policies read the role through
`current_role_is_admin()`, a `security definer` function — reading `profiles`
directly from inside a `profiles` policy would recurse.

**`customers`** is the organizing record — one project per customer. Every visit,
every checklist and every QC card hangs off it. `template_ids` is the set of
checklists chosen when the record was created; `location` is the GPS point
captured while standing at the property, which is what "projects near me" reads.
Addresses are never geocoded, so there is no network call on that path.

**`templates`** and **`shared_config`** hold the checklists. Every signed-in user
reads them; only admins write. `shared_config` is pinned to a single row.

**`inspections.snapshot`** is the important one. Each inspection stores its own
frozen copy of the checklist — questions, sections, and info fields — as it stood
when the inspection began. An admin can reword a question or reorder a section
without altering a single signed record. Verified: after bumping a template to
version 2, the existing inspection still reports snapshot version 1.

**`photos`** indexes files in the private `inspection-photos` storage bucket,
keyed `<inspection_id>/<photo_id>.jpg`. The app reads them through signed URLs,
so interior photos of customers' homes are never publicly addressable.

**`inspection_summary`** is one row per inspection with pass/fail/N-A counts
computed from the responses JSON — the view to point a dashboard or a Google
Sheets mirror at.

**`tombstones`** records what was deleted, so a device that was offline at the
time finds out. Readable by everyone signed in and writable by nobody: the rows
are written by a `security definer` trigger, and there is deliberately no insert
policy.

## Who can do what

| | Inspector | Admin |
| --- | --- | --- |
| Run inspections | ✅ | ✅ |
| Read every completed report | ✅ | ✅ |
| Create and edit customers | ✅ | ✅ |
| Edit an inspection | own, while in progress | any |
| Reopen a signed inspection | ❌ | ✅ |
| Create and edit checklists | ❌ | ✅ |
| Delete customers | ❌ | ✅ |
| Change roles | ❌ | ✅ |

Inspectors read all reports on purpose — recalling someone else's past
walkthrough on a return visit is a real need. Tighten `inspections_select` if you
want that scoped.

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
