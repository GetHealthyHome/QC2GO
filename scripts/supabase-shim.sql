-- ---------------------------------------------------------------------------
-- Just enough of Supabase to run the migrations against a stock PostgreSQL.
--
-- The migrations reference three things a plain database does not have: the
-- `auth` schema and its user table, the `storage` schema and its bucket and
-- object tables, and the `anon` / `authenticated` roles that every policy is
-- written against. This file supplies them, faithfully enough that a policy
-- which passes here passes on Supabase.
--
-- `auth.uid()` is the important one. On Supabase it reads the subject out of
-- the request's JWT claims; here it reads the same setting, so a test can
-- become a given user with `set local request.jwt.claims`.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets (id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Splits an object key into its folder segments, exactly as Supabase does:
-- 'org/inspection/photo.jpg' -> {org,inspection}. The filename is dropped.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;
