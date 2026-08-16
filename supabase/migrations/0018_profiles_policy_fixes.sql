-- ---------------------------------------------------------------------------
-- QC2GO — two faults in the profiles policies, found in a security review
--
-- Both are in how a company's roster is governed, and they mask each other, so
-- they are fixed together.
--
--   1. **Every authenticated UPDATE on `profiles` failed.** `profiles_update_self`
--      pinned the caller's role with an inline sub-select on `profiles` from
--      inside a policy ON `profiles` — the textbook Postgres RLS recursion. Every
--      other policy in this schema reads the table through a `security definer`
--      helper (`current_org_id`, `current_role_is_admin`) for exactly this
--      reason; this one policy reached straight for the table and looped.
--
--   2. **An admin could make itself an owner.** `profiles_admin_all` let anyone
--      the org counts as an admin write any `role` value, owner included, to any
--      profile in the company — self included. Owner is a strictly higher tier:
--      only an owner invites people (`invite-user`) and only an owner manages the
--      webhook endpoints that reach outside the company. So an admin could
--      `PATCH /profiles?id=eq.<self> {role: owner}` and cross that line, or demote
--      the real owner. The app's own UI only ever offers role changes to an
--      owner, and never offers the owner role at all; the policy was looser than
--      the product.
--
-- Fault 2 was reachable only because fault 1 made the UPDATE throw first. Fixing
-- the recursion without fixing the escalation would have opened the door it was
-- accidentally holding shut.
-- ---------------------------------------------------------------------------

-- The caller's own role, read with definer rights so a policy on `profiles` can
-- use it without recursing — the same shape as `current_org_id()`.
create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

-- (1) A user may edit their own row — their name — but not lift themselves out
-- of their company or change their own role. The pin is now via the helper, so
-- there is no sub-select on `profiles` inside a `profiles` policy.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role   = (select public.current_profile_role())
    and org_id = (select public.current_org_id())
  );

-- (2) Managing the roster stays with admins and owners, within their own
-- company — but the owner tier is now sealed: a caller who is not an owner can
-- neither set anyone (themselves included) to `owner`, nor touch a row that is
-- already an owner's. Owners keep full control, which is where creating and
-- moving owners belongs.
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_role_is_admin())
    and (role <> 'owner'::public.user_role or (select public.current_role_is_owner()))
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_role_is_admin())
    and (role <> 'owner'::public.user_role or (select public.current_role_is_owner()))
  );
