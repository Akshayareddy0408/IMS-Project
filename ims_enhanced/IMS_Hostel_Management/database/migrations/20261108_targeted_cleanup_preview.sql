-- Read-only dependency inventory for the targeted test-account cleanup tool.
-- This function never changes data. It lists every FK row pointing at the
-- selected Auth users, students, staff, complaints, or account requests.

create or replace function public.hostelcare_cleanup_dependency_preview(
  p_user_ids uuid[],
  p_student_ids uuid[],
  p_staff_ids uuid[],
  p_complaint_ids uuid[],
  p_account_request_ids uuid[]
)
returns table (
  constraint_name text,
  source_schema text,
  source_table text,
  source_column text,
  target_schema text,
  target_table text,
  delete_action text,
  matching_rows bigint,
  supported boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  fk record;
  target_ids uuid[];
  matched bigint;
begin
  for fk in
    select con.conname,
           con.conrelid,
           con.confrelid,
           cardinality(con.conkey) as key_count,
           src_ns.nspname as src_schema,
           src.relname as src_table,
           src_att.attname as src_column,
           tgt_ns.nspname as tgt_schema,
           tgt.relname as tgt_table,
           tgt_att.attname as tgt_column,
           con.confdeltype
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_namespace src_ns on src_ns.oid = src.relnamespace
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace tgt_ns on tgt_ns.oid = tgt.relnamespace
      left join pg_attribute src_att on src_att.attrelid = con.conrelid and src_att.attnum = con.conkey[1]
      left join pg_attribute tgt_att on tgt_att.attrelid = con.confrelid and tgt_att.attnum = con.confkey[1]
     where con.contype = 'f'
       and (con.confrelid = 'auth.users'::regclass
         or con.confrelid = 'public.students'::regclass
         or con.confrelid = 'public.staff'::regclass
         or con.confrelid = 'public.complaints'::regclass
         or con.confrelid = 'public.account_requests'::regclass)
  loop
    target_ids := case
      when fk.tgt_schema = 'auth' and fk.tgt_table = 'users' then p_user_ids
      when fk.tgt_schema = 'public' and fk.tgt_table = 'students' then p_student_ids
      when fk.tgt_schema = 'public' and fk.tgt_table = 'staff' then p_staff_ids
      when fk.tgt_schema = 'public' and fk.tgt_table = 'complaints' then p_complaint_ids
      when fk.tgt_schema = 'public' and fk.tgt_table = 'account_requests' then p_account_request_ids
      else array[]::uuid[]
    end;
    if coalesce(cardinality(target_ids), 0) = 0 then continue; end if;

    constraint_name := fk.conname;
    source_schema := fk.src_schema;
    source_table := fk.src_table;
    source_column := fk.src_column;
    target_schema := fk.tgt_schema;
    target_table := fk.tgt_table;
    delete_action := case fk.confdeltype
      when 'a' then 'NO ACTION'
      when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'
      when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT'
      else 'UNKNOWN'
    end;

    if fk.key_count <> 1 or fk.src_column is null then
      matching_rows := -1;
      supported := false;
      return next;
      continue;
    end if;

    execute format('select count(*) from %I.%I as source where source.%I = any($1)',
      fk.src_schema, fk.src_table, fk.src_column)
      into matched using target_ids;
    matching_rows := matched;
    supported := true;
    return next;
  end loop;
end;
$$;

revoke all on function public.hostelcare_cleanup_dependency_preview(uuid[], uuid[], uuid[], uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.hostelcare_cleanup_dependency_preview(uuid[], uuid[], uuid[], uuid[], uuid[])
  to service_role;
