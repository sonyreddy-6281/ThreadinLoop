-- Minimal local stand-ins for Supabase-managed roles, auth, and storage.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text not null);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets(id), name text not null);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create function public.test_assert(condition boolean, description text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', description; end if;
  raise notice 'PASS: %', description;
end;
$$;
create function public.test_reject(statement text, description text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute statement;
  exception when others then rejected := true;
  end;
  perform public.test_assert(rejected, description);
end;
$$;
