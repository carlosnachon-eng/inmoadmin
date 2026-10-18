insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('instagram-business-outbound','instagram-business-outbound',false,26214400,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mp4']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists instagram_business_outbound_insert on storage.objects;
create policy instagram_business_outbound_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id='instagram-business-outbound'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists(
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.active=true
      and p.role_id in ('admin','coord_operaciones')
  )
);