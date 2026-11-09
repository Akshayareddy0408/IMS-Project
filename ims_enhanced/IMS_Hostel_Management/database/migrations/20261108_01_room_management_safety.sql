-- Safe room occupancy enforcement and empty-room deletion.
-- Apply after 20261107_hostelcare_security_and_workflows.sql and
-- 20261107_02_auth_role_safety.sql. No rooms or students are deleted.

begin;

do $$
begin
  if exists (
    select 1 from public.rooms
    group by lower(btrim(room_number)) having count(*) > 1
  ) then
    raise exception 'Room numbers contain case-insensitive duplicates; review them before applying this migration.';
  end if;
  if exists (
    select 1 from public.rooms r
    where (select count(*) from public.students s where s.room_id = r.id) > r.capacity
  ) then
    raise exception 'At least one room has more linked students than capacity; review occupancy before applying this migration.';
  end if;
end $$;

create unique index if not exists rooms_room_number_normalized_uidx
  on public.rooms (lower(btrim(room_number)));

alter table public.rooms add column if not exists is_available boolean not null default true;

-- Repair the cached occupancy from the authoritative student.room_id links.
update public.rooms r
set occupied_count = (select count(*) from public.students s where s.room_id = r.id)
where r.occupied_count is distinct from (select count(*) from public.students s where s.room_id = r.id);

create or replace function public.hostelcare_sync_room_occupancy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_room_id uuid;
  new_room_id uuid;
  target_capacity integer;
  target_occupied integer;
  target_available boolean;
  locked_room record;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_room_id := old.room_id; end if;
  if tg_op in ('INSERT', 'UPDATE') then new_room_id := new.room_id; end if;
  if old_room_id is not distinct from new_room_id then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Consistent lock order prevents room-swap deadlocks.
  for locked_room in
    select id from public.rooms
    where id = any(array_remove(array[old_room_id, new_room_id], null))
    order by id for update
  loop
    null;
  end loop;

  if new_room_id is not null then
    select capacity, occupied_count, is_available into target_capacity, target_occupied, target_available
      from public.rooms where id = new_room_id;
    if not found then raise exception 'Room not found'; end if;
    if not target_available then raise exception 'Room is unavailable'; end if;
    if target_occupied >= target_capacity then raise exception 'Room is at capacity'; end if;
  end if;

  if old_room_id is not null then
    update public.rooms set occupied_count = occupied_count - 1
      where id = old_room_id and occupied_count > 0;
    if not found then raise exception 'Room occupancy counter is inconsistent'; end if;
  end if;
  if new_room_id is not null then
    update public.rooms set occupied_count = occupied_count + 1 where id = new_room_id;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'students_sync_room_occupancy' and tgrelid = 'public.students'::regclass and not tgisinternal) then
    execute $trigger$
      create trigger students_sync_room_occupancy
      before insert or delete or update of room_id on public.students
      for each row execute function public.hostelcare_sync_room_occupancy()
    $trigger$;
  end if;
end $$;

create or replace function public.hostelcare_delete_empty_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if exists (select 1 from public.students where room_id = p_room_id)
     or exists (select 1 from public.rooms where id = p_room_id and occupied_count > 0) then
    raise exception 'Room is occupied or linked to students';
  end if;
  delete from public.rooms where id = p_room_id;
end;
$$;

-- Enforce the no-delete-while-linked rule even for server-side paths that do
-- not use the guarded RPC.
create or replace function public.hostelcare_prevent_linked_room_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.occupied_count > 0 or exists (select 1 from public.students where room_id = old.id) then
    raise exception 'Room is occupied or linked to students';
  end if;
  return old;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'rooms_prevent_linked_delete' and tgrelid = 'public.rooms'::regclass and not tgisinternal) then
    execute $trigger$
      create trigger rooms_prevent_linked_delete
      before delete on public.rooms
      for each row execute function public.hostelcare_prevent_linked_room_delete()
    $trigger$;
  end if;
end $$;

revoke all on function public.hostelcare_sync_room_occupancy() from public, anon, authenticated;
revoke all on function public.hostelcare_delete_empty_room(uuid) from public, anon, authenticated;
revoke all on function public.hostelcare_prevent_linked_room_delete() from public, anon, authenticated;
grant execute on function public.hostelcare_delete_empty_room(uuid) to service_role;

commit;
