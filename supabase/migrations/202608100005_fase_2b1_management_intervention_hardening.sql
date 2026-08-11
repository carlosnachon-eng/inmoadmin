begin;

revoke all privileges on table public.gv_management_interventions
from public, anon, authenticated;

grant select on table public.gv_management_interventions
to authenticated;

grant all privileges on table public.gv_management_interventions
to service_role;

drop policy if exists "gv_management_interventions_insert_scope"
  on public.gv_management_interventions;

drop policy if exists "gv_management_interventions_update_scope"
  on public.gv_management_interventions;

drop policy if exists "gv_management_interventions_delete_scope"
  on public.gv_management_interventions;

commit;
