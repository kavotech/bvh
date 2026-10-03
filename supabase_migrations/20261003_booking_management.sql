begin;
create or replace function public.bv_manage(p_id text,p_action text,p_status text,p_actor uuid,p_admin boolean,p_key text,p_hash text,p_emails jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare b bookings; job jsonb; previous_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key,0));
  select payload_hash into previous_hash from submission_receipts where key=p_key;
  if found then
    if previous_hash<>p_hash then raise exception 'idempotency_conflict'; end if;
    return;
  end if;
  select * into b from bookings where id::text=p_id for update;
  if not found or (not p_admin and b.user_id<>p_actor) then raise exception 'forbidden'; end if;
  if p_action<>'cancel' and not p_admin then raise exception 'forbidden'; end if;
  if p_action='cancel' then
    if b.status not in ('Requested','Confirmed','Driver Verification Pending','Pending') then raise exception 'invalid_transition'; end if;
    update bookings set status='Cancellation requested' where id::text=p_id;
  elsif p_action='confirm' then
    if b.status not in ('Requested','Pending','Driver Verification Pending') then raise exception 'invalid_transition'; end if;
    if not exists(select 1 from driver_verifications where booking_id=p_id and verification_status='APPROVED') then raise exception 'driver_not_approved'; end if;
    update bookings set status='Confirmed' where id::text=p_id;
  elsif p_action='cancel_confirm' then
    if b.status='Cancelled' then raise exception 'invalid_transition'; end if;
    update bookings set status='Cancelled' where id::text=p_id;
  elsif p_action in ('approve','reject') then
    update driver_verifications set verification_status=case when p_action='approve' then 'APPROVED' else 'REJECTED' end,
      checked_by_admin=p_actor,checked_date=now(),updated_at=now() where booking_id=p_id;
    if not found then raise exception 'verification_not_found'; end if;
  elsif p_action not in ('invoice','reminder','confirmation') then raise exception 'invalid_action'; end if;
  insert into submission_receipts(key,payload_hash,reference) values(p_key,p_hash,coalesce(b.reference,b.id::text));
  for job in select * from jsonb_array_elements(p_emails) loop
    insert into email_outbox(submission_key,recipient,subject,html,text)
    values(p_key,job->>'recipient',job->>'subject',job->>'html',job->>'text') on conflict do nothing;
  end loop;
end $$;
revoke all on function public.bv_manage(text,text,text,uuid,boolean,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bv_manage(text,text,text,uuid,boolean,text,text,jsonb) to service_role;
commit;
