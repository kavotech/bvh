begin;

alter table public.cars add column if not exists category text;
alter table public.cars add column if not exists registration text;
alter table public.cars add column if not exists daily_rate_pence integer;
alter table public.cars add column if not exists published boolean default true;
alter table public.cars add column if not exists admin_notes text;
update public.cars set daily_rate_pence = round(price_daily * 100)::integer where daily_rate_pence is null and price_daily is not null;
update public.cars set category = coalesce(category, type), published = coalesce(published, is_active, true);
alter table public.cars add constraint cars_daily_rate_pence_positive check (daily_rate_pence is null or daily_rate_pence > 0) not valid;

create table if not exists public.business_settings (
  id boolean primary key default true check (id),
  booking_deposit_pence integer not null default 5000 check (booking_deposit_pence >= 0),
  security_deposit_pence integer not null default 25000 check (security_deposit_pence >= 0),
  insurance_percent_bps integer not null default 2000 check (insurance_percent_bps >= 0 and insurance_percent_bps <= 10000),
  insurance_enabled boolean not null default false,
  insurance_disclosure text not null default '',
  hold_minutes integer not null default 15 check (hold_minutes between 5 and 1440),
  payment_deadline_hours integer not null default 24 check (payment_deadline_hours between 1 and 720),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.business_settings(id) values(true) on conflict (id) do nothing;

create table if not exists public.vehicle_unavailability (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.cars(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default 'Unavailable',
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists vehicle_unavailability_vehicle_window_idx on public.vehicle_unavailability(vehicle_id, starts_at, ends_at);

alter table public.bookings add column if not exists booking_status text not null default 'Draft';
alter table public.bookings add column if not exists payment_status text not null default 'unpaid';
alter table public.bookings add column if not exists collection_at timestamptz;
alter table public.bookings add column if not exists return_at timestamptz;
alter table public.bookings add column if not exists hold_expires_at timestamptz;
alter table public.bookings add column if not exists hire_price_pence integer;
alter table public.bookings add column if not exists booking_deposit_pence integer;
alter table public.bookings add column if not exists outstanding_balance_pence integer;
alter table public.bookings add column if not exists insurance_charge_pence integer;
alter table public.bookings add column if not exists security_deposit_pence integer;
alter table public.bookings add column if not exists total_due_pence integer;
alter table public.bookings add column if not exists paid_total_pence integer not null default 0;
alter table public.bookings add column if not exists payment_deadline_at timestamptz;
alter table public.bookings add column if not exists secure_manage_token_hash text;
create index if not exists bookings_vehicle_window_idx on public.bookings(vehicle_id, collection_at, return_at);
create index if not exists bookings_reference_status_idx on public.bookings(reference, booking_status, payment_status);

create table if not exists public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade,
  vehicle_id uuid not null references public.cars(id) on delete cascade,
  user_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','converted','expired','cancelled')),
  reference text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists booking_holds_vehicle_window_idx on public.booking_holds(vehicle_id, starts_at, ends_at, expires_at, status);
create unique index if not exists booking_holds_one_active_per_booking_idx on public.booking_holds(booking_id) where status='active';

create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  category text not null check (category in ('booking_deposit','remaining_balance','final_balance','insurance_charge','security_deposit','additional_charge')),
  expected_amount_pence integer not null check (expected_amount_pence >= 0),
  received_amount_pence integer not null default 0 check (received_amount_pence >= 0),
  currency text not null default 'gbp' check (currency='gbp'),
  status text not null default 'requires_payment' check (status in ('not_applicable','not_due','requires_payment','processing','paid','failed','cancelled','refunded','partially_refunded')),
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text unique,
  stripe_charge_id text,
  stripe_customer_id text,
  metadata jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(booking_id, category)
);
create index if not exists booking_payments_booking_status_idx on public.booking_payments(booking_id, status);
create index if not exists booking_payments_stripe_intent_idx on public.booking_payments(stripe_payment_intent_id);

create table if not exists public.booking_refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  payment_id uuid references public.booking_payments(id) on delete set null,
  requested_amount_pence integer not null check (requested_amount_pence >= 0),
  actual_amount_pence integer not null default 0 check (actual_amount_pence >= 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','processing','succeeded','failed','cancelled')),
  stripe_refund_id text unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.security_deposit_inspections (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  payment_id uuid references public.booking_payments(id) on delete set null,
  condition_notes text not null default '',
  supporting_evidence jsonb not null default '[]'::jsonb,
  deductions_pence integer not null default 0 check (deductions_pence >= 0),
  deduction_reason text not null default '',
  refund_amount_pence integer not null default 0 check (refund_amount_pence >= 0),
  inspection_status text not null default 'pending' check (inspection_status in ('pending','passed','deductions_proposed','approved_for_refund','refunded','disputed')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  stripe_created_at timestamptz,
  processing_status text not null default 'processing' check (processing_status in ('processing','processed','failed','ignored')),
  booking_id uuid,
  payment_id uuid,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists stripe_webhook_events_type_idx on public.stripe_webhook_events(event_type, received_at);

create or replace function public.bv_vehicle_available(p_vehicle_id uuid,p_start timestamptz,p_end timestamptz,p_exclude_booking uuid default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_start is null or p_end is null or p_end <= p_start then return false; end if;
  if not exists(select 1 from cars where id=p_vehicle_id and coalesce(is_active,true)=true and coalesce(published,true)=true) then return false; end if;
  if exists(select 1 from vehicle_unavailability u where u.vehicle_id=p_vehicle_id and tstzrange(u.starts_at,u.ends_at,'[)') && tstzrange(p_start,p_end,'[)')) then return false; end if;
  if exists(select 1 from booking_holds h where h.vehicle_id=p_vehicle_id and h.status='active' and h.expires_at>now() and (p_exclude_booking is null or h.booking_id is distinct from p_exclude_booking) and tstzrange(h.starts_at,h.ends_at,'[)') && tstzrange(p_start,p_end,'[)')) then return false; end if;
  if exists(select 1 from bookings b where b.vehicle_id=p_vehicle_id and (p_exclude_booking is null or b.id is distinct from p_exclude_booking) and coalesce(b.booking_status,b.status) not in ('Cancelled','Expired','cancelled','expired','Payment failed') and b.collection_at is not null and b.return_at is not null and tstzrange(b.collection_at,b.return_at,'[)') && tstzrange(p_start,p_end,'[)')) then return false; end if;
  return true;
end $$;

create or replace function public.bv_submit(p_key text,p_hash text,p_kind text,p_reference text,p_data jsonb,p_driver jsonb,p_emails jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job jsonb; previous_hash text; v_booking_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key,0));
  select payload_hash into previous_hash from submission_receipts where key=p_key;
  if found then
    if previous_hash<>p_hash then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('reference',(select reference from submission_receipts where key=p_key));
  end if;
  if p_kind='booking' then
    if p_data ? 'collection_at' and p_data ? 'return_at' and p_data ? 'vehicle_id' then
      if not public.bv_vehicle_available((p_data->>'vehicle_id')::uuid,(p_data->>'collection_at')::timestamptz,(p_data->>'return_at')::timestamptz,null) then
        raise exception 'vehicle_unavailable';
      end if;
    end if;
    insert into bookings(user_id,service,van_size,vehicle_id,vehicle_name,name,email,phone,pickup,dropoff,date,time,duration,helpers,price,status,reference,terms_accepted_at,booking_status,payment_status,collection_at,return_at,hold_expires_at,hire_price_pence,booking_deposit_pence,outstanding_balance_pence,insurance_charge_pence,security_deposit_pence,total_due_pence,payment_deadline_at)
    values((p_data->>'user_id')::uuid,p_data->>'service',p_data->>'van_size',(p_data->>'vehicle_id')::uuid,p_data->>'vehicle_name',p_data->>'name',p_data->>'email',p_data->>'phone',p_data->>'pickup',p_data->>'dropoff',(p_data->>'date')::date,p_data->>'time',p_data->>'duration',p_data->>'helpers',p_data->>'price','Awaiting booking deposit',p_reference,(p_data->>'terms_accepted_at')::timestamptz,'Awaiting booking deposit','unpaid',coalesce((p_data->>'collection_at')::timestamptz, ((p_data->>'date') || ' ' || (p_data->>'time'))::timestamptz),coalesce((p_data->>'return_at')::timestamptz, coalesce((p_data->>'collection_at')::timestamptz, ((p_data->>'date') || ' ' || (p_data->>'time'))::timestamptz) + make_interval(hours => case when p_data->>'duration'='custom' then 24 else (p_data->>'duration')::int end)),coalesce((p_data->>'hold_expires_at')::timestamptz, now()+interval '15 minutes'),(p_data->>'hire_price_pence')::integer,(p_data->>'booking_deposit_pence')::integer,(p_data->>'outstanding_balance_pence')::integer,(p_data->>'insurance_charge_pence')::integer,(p_data->>'security_deposit_pence')::integer,(p_data->>'total_due_pence')::integer,coalesce((p_data->>'payment_deadline_at')::timestamptz, now()+interval '24 hours'))
    returning id into v_booking_id;
    insert into booking_holds(booking_id,vehicle_id,user_id,starts_at,ends_at,expires_at,status,reference)
    values(v_booking_id,(p_data->>'vehicle_id')::uuid,(p_data->>'user_id')::uuid,coalesce((p_data->>'collection_at')::timestamptz, ((p_data->>'date') || ' ' || (p_data->>'time'))::timestamptz),coalesce((p_data->>'return_at')::timestamptz, coalesce((p_data->>'collection_at')::timestamptz, ((p_data->>'date') || ' ' || (p_data->>'time'))::timestamptz) + make_interval(hours => case when p_data->>'duration'='custom' then 24 else (p_data->>'duration')::int end)),coalesce((p_data->>'hold_expires_at')::timestamptz, now()+interval '15 minutes'),'active',p_reference);
    insert into booking_payments(booking_id,category,expected_amount_pence,currency,status,due_at) values
      (v_booking_id,'booking_deposit',coalesce((p_data->>'booking_deposit_pence')::integer,0),'gbp','requires_payment',coalesce((p_data->>'payment_deadline_at')::timestamptz, now()+interval '24 hours')),
      (v_booking_id,'remaining_balance',coalesce((p_data->>'outstanding_balance_pence')::integer,0),'gbp',case when coalesce((p_data->>'outstanding_balance_pence')::integer,0)>0 then 'not_due' else 'not_applicable' end,coalesce((p_data->>'payment_deadline_at')::timestamptz, now()+interval '24 hours')),
      (v_booking_id,'insurance_charge',coalesce((p_data->>'insurance_charge_pence')::integer,0),'gbp',case when coalesce((p_data->>'insurance_charge_pence')::integer,0)>0 then 'not_due' else 'not_applicable' end,coalesce((p_data->>'payment_deadline_at')::timestamptz, now()+interval '24 hours')),
      (v_booking_id,'security_deposit',coalesce((p_data->>'security_deposit_pence')::integer,0),'gbp',case when coalesce((p_data->>'security_deposit_pence')::integer,0)>0 then 'not_due' else 'not_applicable' end,coalesce((p_data->>'payment_deadline_at')::timestamptz, now()+interval '24 hours'))
    on conflict (booking_id,category) do nothing;
    insert into driver_verifications(user_id,booking_id,full_name,date_of_birth,driving_licence_number,dvla_check_code,licence_front_file,licence_back_file,verification_status)
    values((p_driver->>'user_id')::uuid,v_booking_id::text,p_driver->>'full_name',(p_driver->>'date_of_birth')::date,p_driver->>'driving_licence_number',p_driver->>'dvla_check_code',p_driver->>'licence_front_file',p_driver->>'licence_back_file','PENDING');
  elsif p_kind='enquiry' then
    insert into enquiries(reference,name,email,phone,service,message)
    values(p_reference,p_data->>'name',p_data->>'email',p_data->>'phone',p_data->>'service',p_data->>'message');
  else raise exception 'invalid_kind'; end if;
  insert into submission_receipts(key,payload_hash,reference) values(p_key,p_hash,p_reference);
  for job in select * from jsonb_array_elements(p_emails) loop
    insert into email_outbox(submission_key,recipient,subject,html,text)
    values(p_key,job->>'recipient',job->>'subject',job->>'html',job->>'text') on conflict do nothing;
  end loop;
  return jsonb_build_object('reference',p_reference,'booking_id',v_booking_id::text);
end $$;

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename in ('business_settings','vehicle_unavailability','booking_holds','booking_payments','booking_refunds','security_deposit_inspections','stripe_webhook_events') loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.business_settings enable row level security;
alter table public.vehicle_unavailability enable row level security;
alter table public.booking_holds enable row level security;
alter table public.booking_payments enable row level security;
alter table public.booking_refunds enable row level security;
alter table public.security_deposit_inspections enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy business_settings_admin_read on public.business_settings for select to authenticated using (auth.jwt()->>'email' = 'info@breezyeevans.co.uk');
create policy booking_payments_owner_read on public.booking_payments for select to authenticated using (exists(select 1 from bookings b where b.id=booking_id and (b.user_id=auth.uid() or auth.jwt()->>'email'='info@breezyeevans.co.uk')));
create policy booking_refunds_owner_read on public.booking_refunds for select to authenticated using (exists(select 1 from bookings b where b.id=booking_id and (b.user_id=auth.uid() or auth.jwt()->>'email'='info@breezyeevans.co.uk')));
create policy security_inspections_owner_read on public.security_deposit_inspections for select to authenticated using (exists(select 1 from bookings b where b.id=booking_id and (b.user_id=auth.uid() or auth.jwt()->>'email'='info@breezyeevans.co.uk')));
create policy vehicle_unavailability_admin_read on public.vehicle_unavailability for select to authenticated using (auth.jwt()->>'email' = 'info@breezyeevans.co.uk');
create policy booking_holds_admin_read on public.booking_holds for select to authenticated using (auth.jwt()->>'email' = 'info@breezyeevans.co.uk');

revoke all on public.business_settings, public.vehicle_unavailability, public.booking_holds, public.booking_payments, public.booking_refunds, public.security_deposit_inspections, public.stripe_webhook_events from anon, authenticated;
grant select on public.business_settings, public.booking_payments, public.booking_refunds, public.security_deposit_inspections to authenticated;
grant all on public.business_settings, public.vehicle_unavailability, public.booking_holds, public.booking_payments, public.booking_refunds, public.security_deposit_inspections, public.stripe_webhook_events to service_role;
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
    if b.status not in ('Requested','Awaiting booking deposit','Reserved','Confirmed','Driver Verification Pending','Pending','Paid','Fully paid') then raise exception 'invalid_transition'; end if;
    update bookings set status='Cancellation requested' where id::text=p_id;
  elsif p_action='confirm' then
    if b.status not in ('Requested','Awaiting booking deposit','Reserved','Pending','Driver Verification Pending','Paid','Fully paid') then raise exception 'invalid_transition'; end if;
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
revoke all on function public.bv_vehicle_available(uuid,timestamptz,timestamptz,uuid), public.bv_submit(text,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bv_vehicle_available(uuid,timestamptz,timestamptz,uuid), public.bv_submit(text,text,text,text,jsonb,jsonb,jsonb) to service_role;

commit;
