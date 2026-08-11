# Supabase backend

Two migrations:

- **`0001_init.sql`** — tables, roles, row-level security, the photo storage
  bucket, and an office summary view.
- **`0002_customers.sql`** — renames `jobs` to `customers` and brings the schema
  in line with the app's model: no job name, job notes became the work scope, a
  customer carries its checklist ids and the GPS point captured on site, and an
  inspection carries the visit date it covers.

Both have been executed end-to-end against PostgreSQL 16 — they run clean, and
the policies, triggers, cascade deletes, summary view, and snapshot isolation all
behave. `0001` is already applied to the live project; `0002` applies on merge.

The app does **not** write to Supabase yet. Everything still runs local-first out
of IndexedDB — sign-in is real, storage is not. See "Still to build" below.

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

`touch_updated_at()` was the one worth fixing — `0002` pins its `search_path`.

## Connecting the app

Set both variables wherever the app is built — Vercel → Settings → Environment
Variables, plus a local `.env` for development:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Both come from **Project Settings → API**. Use the publishable key only.

With them set, every route sits behind a sign-in and the role comes from
`profiles.role`. Without them the app runs local-only and shows a Local mode
banner.

## Still to build

**Sync.** Inspections are still written to IndexedDB and stay on the device that
recorded them — signing in does not yet upload anything. Keeping IndexedDB as the
write path is what preserves working offline in a crawlspace, so the remaining
work is a queue that pushes to these tables when a signal returns, not a rewrite
to fetch-on-demand.

Until that lands, treat the database as provisioned but empty: auth is real,
storage is not yet.
