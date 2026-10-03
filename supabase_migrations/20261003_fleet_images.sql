begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fleet-images','fleet-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create policy "Public fleet image reads" on storage.objects for select using(bucket_id='fleet-images');
create policy "Admin fleet image uploads" on storage.objects for insert to authenticated
with check(bucket_id='fleet-images' and auth.jwt()->>'email'='kavotechuk@gmail.com');
create policy "Admin fleet image removal" on storage.objects for delete to authenticated
using(bucket_id='fleet-images' and auth.jwt()->>'email'='kavotechuk@gmail.com');
commit;
