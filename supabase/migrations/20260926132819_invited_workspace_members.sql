-- Never grant a role to an account created through open self-sign-up.
-- Auth Dashboard invitations are the explicit onboarding path: the first
-- invite becomes workspace admin; later invites become workers.
create or replace function private.bootstrap_first_workspace_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_uuid uuid;
begin
  if new.invited_at is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(812440260926);
  select id into workspace_uuid from public.workspaces order by created_at limit 1;
  if workspace_uuid is null then
    insert into public.workspaces (name) values ('Workkite workspace')
    returning id into workspace_uuid;
    insert into public.workspace_members (workspace_id, user_id, role)
    values (workspace_uuid, new.id, 'admin');
  else
    insert into public.workspace_members (workspace_id, user_id, role)
    values (workspace_uuid, new.id, 'worker')
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.bootstrap_first_workspace_member() from public, anon, authenticated;
