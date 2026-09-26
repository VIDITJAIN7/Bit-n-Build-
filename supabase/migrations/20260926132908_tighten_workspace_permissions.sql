drop policy if exists "admins can manage workspace membership" on public.workspace_members;

drop policy if exists "admins can update workspace state" on public.workspace_state;
create policy "admins can update workspace state"
  on public.workspace_state for update to authenticated
  using (private.has_workspace_role(workspace_id, array['admin']))
  with check (private.has_workspace_role(workspace_id, array['admin']));

-- This event-trigger function only exists to enforce RLS for future tables;
-- it is not an RPC and should not be executable by app users.
revoke execute on function public.rls_auto_enable() from anon, authenticated;
