-- Core multi-tenant persistence for Workkite. The operational payload stays
-- versioned JSON until individual domain tables are migrated incrementally.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'worker')),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id, workspace_id);

create table if not exists public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_media (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_id text not null,
  kind text not null check (kind in ('photo', 'audio')),
  data_url text not null,
  created_at timestamptz not null default now()
);
create index if not exists workspace_media_report_idx
  on public.workspace_media (workspace_id, report_id);

create or replace function private.has_workspace_role(target_workspace uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
      and wm.role = any(allowed_roles)
  );
$$;
revoke all on function private.has_workspace_role(uuid, text[]) from public, anon;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_state enable row level security;
alter table public.workspace_media enable row level security;

revoke all on public.workspaces, public.workspace_members, public.workspace_state,
  public.workspace_media from anon, authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;

create policy "members can read their workspaces"
  on public.workspaces for select to authenticated
  using (private.has_workspace_role(id, array['admin', 'worker']));

create policy "members can read workspace membership"
  on public.workspace_members for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'worker']));

create policy "admins can manage workspace membership"
  on public.workspace_members for all to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));

create policy "admins and workers can read workspace state"
  on public.workspace_state for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'worker']));

create policy "admins can update workspace state"
  on public.workspace_state for all to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));

create policy "workspace members can read report media"
  on public.workspace_media for select to authenticated
  using (private.has_workspace_role(workspace_id, array['admin', 'worker']));

create policy "workspace members can upload report media"
  on public.workspace_media for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['admin', 'worker']));

create policy "workspace admins can delete report media"
  on public.workspace_media for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']));

-- The first verified Auth account becomes the workspace owner. Further users
-- must be explicitly invited and assigned a role by an existing administrator.
create or replace function private.bootstrap_first_workspace_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_uuid uuid;
  workspace_label text;
begin
  perform pg_advisory_xact_lock(812440260926);
  if exists (select 1 from public.workspace_members limit 1) then
    return new;
  end if;
  workspace_label := coalesce(nullif(new.raw_user_meta_data ->> 'workspace_name', ''), 'Workkite workspace');
  insert into public.workspaces (name) values (workspace_label) returning id into workspace_uuid;
  insert into public.workspace_members (workspace_id, user_id, role, display_name)
  values (workspace_uuid, new.id, 'admin', coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;
revoke all on function private.bootstrap_first_workspace_member() from public, anon, authenticated;

drop trigger if exists workkite_bootstrap_first_member on auth.users;
create trigger workkite_bootstrap_first_member
  after insert on auth.users
  for each row execute function private.bootstrap_first_workspace_member();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('field-evidence', 'field-evidence', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "workspace members can upload field evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'field-evidence'
    and (storage.foldername(name))[1] <> ''
    and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['admin', 'worker'])
  );

create policy "workspace members can read field evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'field-evidence'
    and (storage.foldername(name))[1] <> ''
    and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['admin', 'worker'])
  );

create policy "workspace admins can delete field evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'field-evidence'
    and (storage.foldername(name))[1] <> ''
    and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['admin'])
  );
