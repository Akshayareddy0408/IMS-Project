-- HostelCare additive security and workflow migration.
-- Run in Supabase SQL Editor after reviewing against your current project.
-- This migration preserves existing rows and does not drop tables or columns.

create extension if not exists pgcrypto;

alter table public.students add column if not exists auth_user_id uuid;
create unique index if not exists students_auth_user_id_uidx
  on public.students(auth_user_id);

alter table public.staff add column if not exists auth_user_id uuid;
create unique index if not exists staff_auth_user_id_uidx
  on public.staff(auth_user_id);

alter table public.complaints add column if not exists submitted_by uuid;
alter table public.complaints add column if not exists resolution_notes text;
create index if not exists complaints_submitted_by_idx on public.complaints(submitted_by);
create index if not exists complaints_assigned_staff_idx on public.complaints(assigned_staff_id);

create table if not exists public.account_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  full_name text not null,
  email text not null,
  phone text,
  requested_role text not null check (requested_role in ('Maintenance Staff', 'Warden')),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.complaint_activity (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists complaint_activity_complaint_idx
  on public.complaint_activity(complaint_id, created_at desc);

-- Turn on RLS for tables exposed to the browser client. The Express API uses
-- server-side service credentials only after verifying the caller's JWT and role.
alter table public.rooms enable row level security;
alter table public.students enable row level security;
alter table public.staff enable row level security;
alter table public.complaints enable row level security;
alter table public.resources enable row level security;
alter table public.resource_transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;
alter table public.account_requests enable row level security;
alter table public.complaint_activity enable row level security;

-- The frontend uses Supabase Auth directly, not direct table access. No anon or
-- authenticated table policies are added here. Existing policies are preserved.
