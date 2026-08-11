# Supabase backend

`migrations/0001_init.sql` is the full schema: tables, roles, row-level security,
the photo storage bucket, and an office summary view. It has been executed
end-to-end against PostgreSQL 16 — it runs clean and the policies, triggers, and
view all behave.

The app does **not** talk to Supabase yet. Everything still runs local-first out
of IndexedDB. This is the target schema, ready to run.

## Setting it up

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `migrations/0001_init.sql`, run it.
   Or, with the CLI: `supabase link --project-ref <ref> && supabase db push`.
3. Under **Authentication → Providers**, confirm **Email** is enabled. Turn off
   "Confirm email" only if inspectors will be onboarded by hand.
4. Invite users under **Authentication → Users**. Everyone lands as an
   `inspector`. Promote yourself:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

5. From **Project Settings → API**, note the project URL and the publishable
   (anon) key. Those are the two values the app will need.

## How the schema is shaped

**`profiles`** extends `auth.users` with a `role` of `admin` or `inspector`. A
trigger creates the row on signup, defaulting to `inspector`, so promotion is
always a deliberate act. Policies read the role through
`current_role_is_admin()`, a `security definer` function — reading `profiles`
directly from inside a `profiles` policy would recurse.

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
| Create and edit jobs | ✅ | ✅ |
| Edit an inspection | own, while in progress | any |
| Reopen a signed inspection | ❌ | ✅ |
| Create and edit checklists | ❌ | ✅ |
| Delete jobs | ❌ | ✅ |
| Change roles | ❌ | ✅ |

Inspectors read all reports on purpose — recalling someone else's past
walkthrough on a return visit is a real need. Tighten `inspections_select` if you
want that scoped.

## Still to build

Wiring the app to this schema means: a sign-in screen, replacing the local role
toggle with `profiles.role`, and a sync layer that pushes the IndexedDB queue
when a signal returns. Keeping IndexedDB as the write path is what preserves
working offline in a crawlspace — Supabase becomes the thing it syncs to, not the
thing it depends on.
