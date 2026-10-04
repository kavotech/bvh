-- Booking approval workflow. Safe incremental migration; no existing accounts are changed.
alter table public.bookings add column if not exists approval_status text not null default 'Pending Approval';
alter table public.bookings add column if not exists approved_at timestamptz;
alter table public.bookings add column if not exists approved_by uuid;
alter table public.bookings add column if not exists rejected_at timestamptz;
alter table public.bookings add column if not exists rejected_by uuid;
alter table public.bookings add column if not exists rejection_reason text;
alter table public.bookings add column if not exists terms_version text;
alter table public.bookings add column if not exists terms_accepted_at timestamptz;
create index if not exists bookings_approval_status_idx on public.bookings(approval_status, created_at desc);

create table if not exists public.booking_approval_audit (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  action text not null check (action in ('approved','rejected')),
  actor_id uuid not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists booking_approval_audit_booking_idx on public.booking_approval_audit(booking_id, created_at desc);
alter table public.booking_approval_audit enable row level security;
revoke all on public.booking_approval_audit from anon, authenticated;
grant all on public.booking_approval_audit to service_role;
