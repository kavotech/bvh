-- Dynamic booking deposits, vehicle-specific refundable deposit policy and admin auth repair.

alter table public.business_settings
  add column if not exists booking_deposit_percent_bps integer not null default 2500 check (booking_deposit_percent_bps between 0 and 10000),
  add column if not exists booking_deposit_cap_pence integer not null default 0 check (booking_deposit_cap_pence >= 0);

comment on column public.business_settings.booking_deposit_percent_bps is 'Booking deposit percentage in basis points. 2500 = 25%.';
comment on column public.business_settings.booking_deposit_cap_pence is 'Optional maximum booking deposit in pence. 0 means no cap except hire price.';

update public.business_settings
set booking_deposit_percent_bps = 2500,
    booking_deposit_cap_pence = 0,
    updated_at = now()
where id = true
  and (booking_deposit_percent_bps is distinct from 2500 or booking_deposit_cap_pence is distinct from 0);

alter table public.cars
  add column if not exists security_deposit_pence integer check (security_deposit_pence is null or security_deposit_pence >= 0),
  add column if not exists security_deposit_policy text;

comment on column public.cars.security_deposit_pence is 'Optional vehicle-specific refundable security deposit in pence. Null uses business_settings.security_deposit_pence.';
comment on column public.cars.security_deposit_policy is 'Admin-visible policy note explaining the vehicle-specific refundable deposit.';

update public.cars
set security_deposit_policy = coalesce(security_deposit_policy, 'Default refundable security deposit retained pending approved vehicle-specific insurance and rental agreement policy.')
where security_deposit_policy is null;

-- The existing admin user was created through a custom OTP path and could remain unconfirmed,
-- causing dashboard login to fail after a valid code. Repair only the explicitly authorised admin.
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('password_set', true, 'email_verified', true, 'full_name', coalesce(raw_user_meta_data->>'full_name', 'Breezyee Vans Admin')),
    updated_at = now()
where lower(email) = 'info@breezyeevans.co.uk';
