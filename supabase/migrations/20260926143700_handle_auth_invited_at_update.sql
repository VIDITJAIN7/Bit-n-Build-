-- Supabase may set invited_at in a follow-up UPDATE after inserting the auth
-- user. Handle both paths so the first invited user becomes the workspace admin.
create or replace function private.bootstrap_first_workspace_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_uuid uuid;
  assigned_role text;
begin
  if new.invited_at is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(812440260926);

  select id into workspace_uuid
  from public.workspaces
  order by created_at
  limit 1;

  if workspace_uuid is null then
    insert into public.workspaces (name)
    values (coalesce(nullif(new.raw_user_meta_data ->> 'workspace_name', ''), 'Workkite workspace'))
    returning id into workspace_uuid;
    assigned_role := 'admin';
  else
    assigned_role := 'worker';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, display_name)
  values (
    workspace_uuid,
    new.id,
    assigned_role,
    coalesce(new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists workkite_bootstrap_first_member on auth.users;
create trigger workkite_bootstrap_first_member
  after insert or update of invited_at on auth.users
  for each row execute function private.bootstrap_first_workspace_member();

-- Backfill invited accounts created before this migration. The advisory lock
-- in the trigger serializes the initial admin assignment.
do $$
declare
  invited_user record;
begin
  for invited_user in
    select u.id
    from auth.users u
    where u.invited_at is not null
      and not exists (
        select 1 from public.workspace_members wm where wm.user_id = u.id
      )
    order by u.created_at
  loop
    update auth.users
    set invited_at = invited_at
    where id = invited_user.id;
  end loop;
end;
$$;
