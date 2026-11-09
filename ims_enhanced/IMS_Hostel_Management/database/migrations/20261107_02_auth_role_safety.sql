-- Follow-up hardening for the 20261107 HostelCare migration.
-- Add constraints without scanning/rejecting legacy rows; new writes are checked.
-- No existing data is changed or deleted.

create index if not exists account_requests_status_created_idx
  on public.account_requests(status, created_at desc);
create index if not exists resource_transactions_resource_created_idx
  on public.resource_transactions(resource_id, created_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.students'::regclass and conname = 'students_auth_user_fk') then
    alter table public.students add constraint students_auth_user_fk
      foreign key (auth_user_id) references auth.users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.staff'::regclass and conname = 'staff_auth_user_fk') then
    alter table public.staff add constraint staff_auth_user_fk
      foreign key (auth_user_id) references auth.users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.complaints'::regclass and conname = 'complaints_submitted_by_fk') then
    alter table public.complaints add constraint complaints_submitted_by_fk
      foreign key (submitted_by) references auth.users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.account_requests'::regclass and conname = 'account_requests_user_fk') then
    alter table public.account_requests add constraint account_requests_user_fk
      foreign key (user_id) references auth.users(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.account_requests'::regclass and conname = 'account_requests_reviewer_fk') then
    alter table public.account_requests add constraint account_requests_reviewer_fk
      foreign key (reviewed_by) references auth.users(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.complaint_activity'::regclass and conname = 'complaint_activity_actor_fk') then
    alter table public.complaint_activity add constraint complaint_activity_actor_fk
      foreign key (actor_user_id) references auth.users(id) on delete set null not valid;
  end if;
end $$;

-- Atomically persist Administrator quantity changes and their audit entry.
create or replace function public.set_resource_quantity(
  p_resource_id uuid,
  p_quantity integer,
  p_actor_staff_id uuid default null
)
returns setof public.resources
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_quantity integer;
  updated_resource public.resources%rowtype;
begin
  if p_quantity < 0 or p_quantity > 100000 then
    raise exception 'Quantity must be between 0 and 100000';
  end if;

  select quantity into old_quantity
    from public.resources where id = p_resource_id for update;
  if not found then raise exception 'Resource not found'; end if;

  update public.resources set quantity = p_quantity
    where id = p_resource_id returning * into updated_resource;

  if old_quantity <> p_quantity then
    insert into public.resource_transactions(resource_id, transaction_type, quantity, note, staff_id)
    values (
      p_resource_id,
      case when p_quantity > old_quantity then 'IN' else 'OUT' end,
      abs(p_quantity - old_quantity),
      'Quantity updated in HostelCare',
      p_actor_staff_id
    );
  end if;

  return next updated_resource;
end;
$$;
revoke all on function public.set_resource_quantity(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.set_resource_quantity(uuid, integer, uuid) to service_role;

-- This app accesses these tables only through its authenticated Express API.
-- RLS remains enabled and browser roles receive no direct table privileges.
revoke all on table public.rooms, public.students, public.staff, public.complaints,
  public.resources, public.resource_transactions, public.notifications,
  public.activity_logs, public.account_requests, public.complaint_activity
  from anon, authenticated;

grant select, insert, update, delete on table public.rooms, public.students,
  public.staff, public.complaints, public.resources, public.resource_transactions,
  public.notifications, public.activity_logs, public.account_requests,
  public.complaint_activity to service_role;
