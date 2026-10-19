-- Private outbound staging for Messenger. No public reads or overwrites.
-- The sender must additionally validate thread grants, media bytes and durable action state.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('facebook-messenger-outbound','facebook-messenger-outbound',false,26214400,
 array['image/jpeg','image/png','image/webp','video/mp4','audio/mp4']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists facebook_messenger_outbound_insert on storage.objects;
create policy facebook_messenger_outbound_insert on storage.objects
for insert to authenticated
with check (
 bucket_id='facebook-messenger-outbound'
 and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true
  and p.role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico'))
);
