-- RLS does not constrain TRUNCATE: remove non-DML grants as well as anon access.
revoke all on public.cierre_pagos from public, anon, authenticated;
grant select, insert, update, delete on public.cierre_pagos to authenticated;
alter table public.cierre_pagos enable row level security;

-- Reuse the established internal-reader check and the parent cierre's RLS.
-- Restrictive scope remains effective even if another permissive policy exists.
create policy cierre_pagos_internal_scope on public.cierre_pagos
as restrictive for all to authenticated
using (
 (select public.profiles_is_active_internal_reader())
 and exists(select 1 from public.cierres c where c.id=cierre_pagos.cierre_id)
)
with check (
 (select public.profiles_is_active_internal_reader())
 and exists(select 1 from public.cierres c where c.id=cierre_pagos.cierre_id)
);
create policy cierre_pagos_internal_select on public.cierre_pagos
for select to authenticated using (true);
create policy cierre_pagos_admin_insert on public.cierre_pagos
for insert to authenticated with check (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
);
create policy cierre_pagos_admin_update on public.cierre_pagos
for update to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
)
with check (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
);
create policy cierre_pagos_admin_delete on public.cierre_pagos
for delete to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
);

-- A restrictive write guard prevents older permissive policies from allowing
-- a non-admin to mutate financial data.
create policy cierre_pagos_admin_update_guard on public.cierre_pagos
as restrictive for update to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
)
with check (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
);
create policy cierre_pagos_admin_insert_guard on public.cierre_pagos
as restrictive for insert to authenticated with check (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
);
create policy cierre_pagos_admin_delete_guard on public.cierre_pagos
as restrictive for delete to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role_id='admin')
);
