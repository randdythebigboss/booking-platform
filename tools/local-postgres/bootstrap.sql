-- ===========================================================================
-- Supabase-alike prerequisites for a plain PostgreSQL instance.
--
-- This is NOT part of the schema. Supabase provides all of it, so it must not
-- live in supabase/migrations. It exists so the migrations and the SQL suites
-- can be executed on any stock PostgreSQL, which is how they get validated
-- when Docker and the Supabase CLI are not available.
--
-- Run it against an empty database BEFORE the migrations.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Roles. PostgREST connects as one of these; the policies name them directly.
-- ---------------------------------------------------------------------------

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
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges broadly and relies on RLS to constrain
-- them. Reproducing that exactly matters: without it, a policy test would
-- pass for the wrong reason -- "permission denied" instead of "no rows".
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The extensions schema, where Supabase keeps pgcrypto.
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- A minimal auth schema: only what this project's migrations, seed and tests
-- actually touch.
-- ---------------------------------------------------------------------------

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);

-- The function every RLS policy in this project ultimately depends on.
-- Mirrors Supabase: the user id comes from the request's JWT claims.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  -- nullif on the SETTING, not just on the extracted value: Supabase's own
  -- auth.uid() tolerates an empty claims string, and casting '' to jsonb
  -- raises. Matching it keeps local behaviour honest.
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')::text;
$$;
