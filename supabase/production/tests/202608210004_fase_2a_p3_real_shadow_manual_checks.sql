-- READ-ONLY. Production readiness checks for the manual real-message P3 path.
do $$
begin
  if to_regclass('public.shadow_messages') is null
     or to_regclass('public.shadow_conversations') is null
     or to_regclass('public.shadow_ai_runs') is null
     or to_regclass('public.shadow_ai_decisions') is null then
    raise exception 'P3 Shadow production schema is incomplete';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='shadow_ai_runs'
      and column_name='input_kind' and is_nullable='NO'
  ) then raise exception 'shadow_ai_runs.input_kind is missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.shadow_ai_runs'::regclass
      and pg_get_constraintdef(oid) like '%conversational_message%message_id%'
  ) then raise exception 'conversational run identity constraint is missing'; end if;

  if not (select relrowsecurity from pg_class where oid='public.shadow_ai_runs'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.shadow_ai_decisions'::regclass) then
    raise exception 'RLS must remain enabled for AI audit tables';
  end if;

  if has_table_privilege('anon','public.shadow_ai_runs','SELECT')
     or has_table_privilege('anon','public.shadow_ai_decisions','SELECT')
     or has_table_privilege('authenticated','public.shadow_ai_runs','INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.shadow_ai_decisions','INSERT,UPDATE,DELETE') then
    raise exception 'Shadow AI grants are broader than allowed';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename in ('shadow_ai_runs','shadow_ai_decisions')
      and (qual ~* '^\s*true\s*$' or with_check ~* '^\s*true\s*$')
  ) then raise exception 'Open Shadow AI policy detected'; end if;
end $$;
