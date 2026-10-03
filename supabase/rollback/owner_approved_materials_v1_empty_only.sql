-- Separate operator-authorized rollback. Never run automatically. OFF first.
-- Once evidence/approved assets exist, preserve schema/data; rollback is application OFF only.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.owner_material_deliveries,public.owner_approved_material_versions in access exclusive mode;
do $$ begin
  if exists(select 1 from public.owner_material_deliveries) or exists(select 1 from public.owner_approved_material_versions) or
     exists(select 1 from storage.objects where bucket_id='owner-approved-materials') then
    raise exception 'owner_materials_not_empty_preserve_evidence';
  end if;
end $$;
drop function public.activate_owner_material_version(uuid);
drop function public.reserve_owner_material_delivery(uuid,uuid,text,text);
drop function public.claim_owner_material_delivery(uuid);
drop table public.owner_material_deliveries;
drop table public.owner_approved_material_versions;
drop function public.guard_owner_material_version();
drop function public.guard_owner_material_delivery();
drop policy owner_material_objects_private on storage.objects;
delete from storage.buckets where id='owner-approved-materials';
commit;
