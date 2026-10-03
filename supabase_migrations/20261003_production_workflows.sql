-- Apply after the two existing migrations, in the Supabase SQL editor.
-- Review against your live schema first. This migration does not delete customer data.
begin;
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id),
  service text, van_size text, pickup text, dropoff text, date date, time text,
  duration text, helpers text, name text, email text, phone text, price text,
  status text default 'Requested', created_at timestamptz default now()
);
alter table public.bookings add column if not exists reference text;
alter table public.bookings add column if not exists vehicle_id uuid;
alter table public.bookings add column if not exists vehicle_name text;
alter table public.bookings add column if not exists terms_accepted_at timestamptz;
create unique index if not exists bookings_reference_unique on public.bookings(reference);
create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(), reference text unique not null,
  name text not null, email text not null, phone text not null, service text not null,
  message text not null, created_at timestamptz default now()
);
create table if not exists public.submission_receipts (
  key text primary key, payload_hash text not null, reference text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(), submission_key text not null,
  recipient text not null, subject text not null, html text not null, text text not null,
  created_at timestamptz not null default now(), first_attempt_at timestamptz,
  locked_until timestamptz, sent_at timestamptz, provider_id text,
  unique(submission_key, recipient)
);
create table if not exists public.request_limits (
  key text primary key, window_start timestamptz not null default now(), hits integer not null default 1
);
alter table public.bookings enable row level security;
alter table public.enquiries enable row level security;
alter table public.submission_receipts enable row level security;
alter table public.email_outbox enable row level security;
alter table public.request_limits enable row level security;
-- Remove old permissive booking policies so browser writes cannot bypass verification.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='bookings' loop
    execute format('drop policy %I on public.bookings', p.policyname);
  end loop;
end $$;
create policy bookings_read on public.bookings for select to authenticated
  using (auth.uid() = user_id or auth.jwt()->>'email' = 'kavotechuk@gmail.com');
revoke all on public.bookings from anon;
revoke insert,update,delete on public.bookings from authenticated;
grant select on public.bookings to authenticated;
revoke all on public.enquiries, public.submission_receipts, public.email_outbox, public.request_limits from anon, authenticated;
grant all on public.bookings, public.enquiries, public.submission_receipts, public.email_outbox, public.request_limits to service_role;
-- Verification rows are created atomically with bookings, and updated by the server.
revoke insert,update,delete on public.driver_verifications from anon, authenticated;
revoke all on public.driver_verification_notifications from anon, authenticated;
update storage.buckets set public=false, file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf']
  where id='driver-verification-documents';

create or replace function public.bv_rate_limit(p_key text, p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  delete from request_limits where window_start < now()-interval '1 day';
  insert into request_limits(key) values(p_key)
  on conflict(key) do update set
    hits=case when request_limits.window_start < now()-interval '15 minutes' then 1 else request_limits.hits+1 end,
    window_start=case when request_limits.window_start < now()-interval '15 minutes' then now() else request_limits.window_start end
  returning hits into n;
  return n <= p_limit;
end $$;

create or replace function public.bv_submit(p_key text, p_hash text, p_kind text, p_reference text, p_data jsonb, p_driver jsonb, p_emails jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare receipt submission_receipts; booking_id text; job jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key,0));
  select * into receipt from submission_receipts where key=p_key;
  if found then
    if receipt.payload_hash <> p_hash then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('reference',receipt.reference);
  end if;
  if p_kind='booking' then
    insert into bookings(user_id,service,van_size,vehicle_id,vehicle_name,name,email,phone,pickup,dropoff,date,time,duration,helpers,price,status,reference,terms_accepted_at)
    values((p_data->>'user_id')::uuid,p_data->>'service',p_data->>'van_size',(p_data->>'vehicle_id')::uuid,p_data->>'vehicle_name',p_data->>'name',p_data->>'email',p_data->>'phone',p_data->>'pickup',p_data->>'dropoff',(p_data->>'date')::date,p_data->>'time',p_data->>'duration',p_data->>'helpers',p_data->>'price','Requested',p_reference,(p_data->>'terms_accepted_at')::timestamptz)
    returning id::text into booking_id;
    insert into driver_verifications(user_id,booking_id,full_name,date_of_birth,driving_licence_number,dvla_check_code,licence_front_file,licence_back_file,verification_status)
    values((p_driver->>'user_id')::uuid,booking_id,p_driver->>'full_name',(p_driver->>'date_of_birth')::date,p_driver->>'driving_licence_number',p_driver->>'dvla_check_code',p_driver->>'licence_front_file',p_driver->>'licence_back_file','PENDING');
  elsif p_kind='enquiry' then
    insert into enquiries(reference,name,email,phone,service,message)
    values(p_reference,p_data->>'name',p_data->>'email',p_data->>'phone',p_data->>'service',p_data->>'message');
  else raise exception 'invalid_kind'; end if;
  insert into submission_receipts(key,payload_hash,reference) values(p_key,p_hash,p_reference);
  for job in select * from jsonb_array_elements(p_emails) loop
    insert into email_outbox(submission_key,recipient,subject,html,text)
    values(p_key,job->>'recipient',job->>'subject',job->>'html',job->>'text') on conflict do nothing;
  end loop;
  return jsonb_build_object('reference',p_reference);
end $$;

create or replace function public.bv_claim_emails(p_submission_key text default null)
returns setof public.email_outbox language sql security definer set search_path=public as $$
  update email_outbox set locked_until=now()+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,now())
  where id in (select id from email_outbox
    where sent_at is null and (locked_until is null or locked_until < now())
      and (first_attempt_at is null or first_attempt_at > now()-interval '23 hours')
      and (p_submission_key is null or submission_key=p_submission_key)
    order by created_at for update skip locked limit 10)
  returning *;
$$;
-- Stop automatic retry before Resend's 24-hour idempotency window expires.
-- Operator must reconcile older pending rows against provider receipts before retrying.
revoke all on function public.bv_rate_limit(text,integer),public.bv_submit(text,text,text,text,jsonb,jsonb,jsonb),public.bv_claim_emails(text) from public,anon,authenticated;
grant execute on function public.bv_rate_limit(text,integer),public.bv_submit(text,text,text,text,jsonb,jsonb,jsonb),public.bv_claim_emails(text) to service_role;
commit;
