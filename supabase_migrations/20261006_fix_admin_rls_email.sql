-- Several early migrations (create_cars_table.sql, create_driver_verifications.sql,
-- 20261003_fleet_images.sql, 20261003_production_workflows.sql) hardcoded admin-only
-- RLS policies against 'kavotechuk@gmail.com'. The application and every later migration
-- (20261003_booking_payment_system.sql) use 'info@breezyeevans.co.uk' (ADMIN_EMAIL /
-- VITE_ADMIN_EMAIL). Apply this migration to a project where any of those earlier
-- migrations ran, so admin-only access on cars/driver_verifications/bookings/storage
-- is not silently pinned to the old address.
--
-- A single helper function is introduced so the admin address only needs to be changed
-- in one place in the future.
begin;

create or replace function public.bv_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'info@breezyeevans.co.uk';
$$;

-- cars (create_cars_table.sql)
drop policy if exists "Allow admin full access" on public.cars;
create policy "Allow admin full access" on public.cars
  for all using (public.bv_is_admin()) with check (public.bv_is_admin());

-- driver_verifications / driver_verification_notifications (create_driver_verifications.sql)
drop policy if exists "Customers can view their own driver verification" on public.driver_verifications;
create policy "Customers can view their own driver verification" on public.driver_verifications
  for select using (auth.uid() = user_id or public.bv_is_admin());

drop policy if exists "Admin can manage all driver verifications" on public.driver_verifications;
create policy "Admin can manage all driver verifications" on public.driver_verifications
  for all using (public.bv_is_admin()) with check (public.bv_is_admin());

drop policy if exists "Users can queue verification emails" on public.driver_verification_notifications;
create policy "Users can queue verification emails" on public.driver_verification_notifications
  for insert with check (recipient_email = auth.jwt() ->> 'email' or public.bv_is_admin());

drop policy if exists "Admin can view verification emails" on public.driver_verification_notifications;
create policy "Admin can view verification emails" on public.driver_verification_notifications
  for select using (public.bv_is_admin());

-- driver-verification-documents storage bucket (create_driver_verifications.sql)
drop policy if exists "Admin can read verification documents" on storage.objects;
create policy "Admin can read verification documents" on storage.objects
  for select using (bucket_id = 'driver-verification-documents' and public.bv_is_admin());

drop policy if exists "Admin can delete verification documents" on storage.objects;
create policy "Admin can delete verification documents" on storage.objects
  for delete using (bucket_id = 'driver-verification-documents' and public.bv_is_admin());

-- fleet-images storage bucket (20261003_fleet_images.sql)
drop policy if exists "Admin fleet image uploads" on storage.objects;
create policy "Admin fleet image uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fleet-images' and public.bv_is_admin());

drop policy if exists "Admin fleet image removal" on storage.objects;
create policy "Admin fleet image removal" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fleet-images' and public.bv_is_admin());

-- bookings read policy (20261003_production_workflows.sql); harmless no-op if a later
-- migration already dropped/replaced it.
drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated
  using (auth.uid() = user_id or public.bv_is_admin());

commit;
