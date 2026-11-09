-- Smart Hostel Complaint and Resource Management System
-- Run this script in Supabase Dashboard > SQL Editor > New query > Run.
-- This schema is for the IMS demo backend. It does not enable public access.

create extension if not exists pgcrypto;

-- Hostel rooms
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_number text not null unique,
  block text not null,
  floor integer,
  capacity integer not null default 2 check (capacity > 0),
  is_available boolean not null default true,
  occupied_count integer not null default 0 check (occupied_count >= 0 and occupied_count <= capacity),
  created_at timestamptz not null default now()
);

-- Students
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique,
  phone text,
  room_id uuid references public.rooms(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Hostel staff: wardens, admins, maintenance staff
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique,
  phone text,
  role text not null check (role in ('Admin', 'Warden', 'Maintenance')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Complaints (fields line up with the current demo UI)
create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  student_id uuid references public.students(id) on delete set null,
  student_name text not null,
  room text not null,
  category text not null,
  title text not null,
  description text not null,
  priority text not null default 'Medium'
    check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  status text not null default 'Submitted'
    check (status in ('Submitted', 'Reviewed', 'Assigned', 'In Progress', 'Resolved', 'Closed')),
  assigned_staff_id uuid references public.staff(id) on delete set null,
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists complaints_status_idx on public.complaints(status);
create index if not exists complaints_priority_idx on public.complaints(priority);
create index if not exists complaints_created_at_idx on public.complaints(created_at desc);

-- Resources / inventory
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  location text not null,
  quantity integer not null default 0 check (quantity >= 0),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  unit text not null default 'pcs',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep an audit trail of inventory changes
create table if not exists public.resource_transactions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('IN', 'OUT', 'ADJUSTMENT')),
  quantity integer not null check (quantity > 0),
  note text,
  staff_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Optional flexible records for notifications and app activity
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_student_id uuid references public.students(id) on delete cascade,
  recipient_staff_id uuid references public.staff(id) on delete cascade,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (recipient_student_id is not null or recipient_staff_id is not null)
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid references public.staff(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Automatically refresh updated_at on edits
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists complaints_set_updated_at on public.complaints;
create trigger complaints_set_updated_at
before update on public.complaints
for each row execute function public.set_updated_at();

drop trigger if exists resources_set_updated_at on public.resources;
create trigger resources_set_updated_at
before update on public.resources
for each row execute function public.set_updated_at();

-- Demo resources matching the starter UI. Safe to run more than once.
insert into public.resources (name, category, location, quantity, minimum_stock, unit)
select v.name, v.category, v.location, v.quantity, v.minimum_stock, v.unit
from (values
  ('LED Bulb 9W', 'Electrical', 'Store Room 1', 42, 15, 'pcs'),
  ('Tap Washer', 'Plumbing', 'Store Room 1', 8, 20, 'pcs'),
  ('Ceiling Fan', 'Electrical', 'Store Room 2', 6, 4, 'pcs'),
  ('Cleaning Liquid', 'Housekeeping', 'Cleaning Store', 18, 10, 'bottles'),
  ('Door Handle', 'Furniture', 'Store Room 2', 3, 8, 'pcs')
) as v(name, category, location, quantity, minimum_stock, unit)
where not exists (
  select 1 from public.resources r where r.name = v.name and r.location = v.location
);

-- Example starter staff and complaints can be entered from the UI/backend later.
-- Security note: enable RLS and add policies before exposing tables to browser clients.
-- The Express backend should use the Supabase service-role key only on the server.
