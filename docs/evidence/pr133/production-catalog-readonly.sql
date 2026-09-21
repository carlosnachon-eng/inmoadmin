-- DOCUMENTED PREFLIGHT ONLY. NOT EXECUTED in this review.
-- Verify the official dashboard/connection targets bnzrnizrmonjxlktbhlp first.
-- postgres/current_database alone cannot identify the Supabase project.
-- Catalog metadata only; no business rows, mutations, fixtures or functional RPCs.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

select current_user as operator_role, current_database() as database_name,
  current_setting('server_version_num') as server_version_num,
  current_setting('transaction_read_only') as read_only;

with expected(name) as (values
  ('public.unidades_condominio'),('public.condominios'),('public.profiles'),
  ('public.client_identities'),('public.client_identity_roles'),('public.client_source_links'),
  ('public.client_reconciliation_candidates'),('public.client_reconciliation_candidate_sources'),
  ('public.client_identity_audit'),('public.respond_identity_links'),('public.respond_identity_audit'),
  ('public.contracts'),('public.properties'))
select e.name, c.oid is not null as present, c.relkind,
  pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity,
  c.relacl, c.reltuples as estimated_rows, c.relpages as estimated_pages,
  case when c.oid is not null then pg_has_role(current_user,c.relowner,'USAGE') end as operator_is_owner_or_member
from expected e left join pg_class c on c.oid=to_regclass(e.name) order by e.name;

select n.nspname as schema_name,c.relname as table_name,a.attname as column_name,
  format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,a.attidentity,a.attgenerated,
  pg_get_expr(d.adbin,d.adrelid) as default_expression
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where n.nspname='public' and c.relname in ('unidades_condominio','condominios','profiles',
  'client_identities','client_identity_roles','client_source_links','client_reconciliation_candidates',
  'client_reconciliation_candidate_sources','client_identity_audit','respond_identity_links','respond_identity_audit')
  and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum;

select c.conrelid::regclass as table_name,c.conname,c.contype,c.convalidated,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in ('unidades_condominio','condominios','profiles',
  'client_identities','client_identity_roles','client_source_links','client_reconciliation_candidates',
  'client_reconciliation_candidate_sources','client_identity_audit','respond_identity_links','respond_identity_audit')
order by c.conrelid::regclass::text,c.conname;

select i.indrelid::regclass as table_name,i.indexrelid::regclass as index_name,
  i.indisunique,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) as definition
from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in ('unidades_condominio','condominios','client_identities',
  'client_identity_roles','client_source_links','client_reconciliation_candidates',
  'client_reconciliation_candidate_sources','client_identity_audit','respond_identity_links','respond_identity_audit')
order by i.indrelid::regclass::text,i.indexrelid::regclass::text;

with expected(signature,expectation) as (values
  ('public.confirm_client_reconciliation_candidate(uuid,uuid,uuid)','existing uuid return'),
  ('public.review_client_reconciliation_candidate(uuid,uuid,text)','existing text return'),
  ('extensions.digest(text,text)','existing bytea return'),
  ('pg_catalog.hashtextextended(text,bigint)','existing bigint return'),
  ('gen_random_uuid()','existing uuid return'),
  ('public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamp with time zone,text,text,uuid)','historical unchanged'),
  ('public.confirm_exact_phone_respond_identity_link_core(text,uuid,text,text,timestamp with time zone,text,text,uuid)','historical unchanged'),
  ('public.confirm_rental_client_candidate_v1(uuid,uuid,uuid)','absent before installation'),
  ('public.review_rental_client_candidate_v1(uuid,uuid,text)','absent before installation'),
  ('public.version_condominium_owner_identity()','absent before installation'),
  ('public.check_condominium_identity_source()','absent before installation'),
  ('public.condominium_identity_phone_digest(text)','absent before installation'),
  ('public.review_condominium_owner_identity(text,uuid,text,uuid,text,timestamp with time zone,uuid,text,boolean)','absent before installation'))
select e.signature,e.expectation,p.oid is not null as present,
  pg_get_function_result(p.oid) as returns,pg_get_userbyid(p.proowner) as owner,
  p.prosecdef,p.proconfig,p.proacl,p.pronargdefaults,md5(p.prosrc) as body_md5,
  case when p.oid is not null then pg_has_role(current_user,p.proowner,'USAGE') end as operator_is_owner_or_member
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature) order by e.signature;

select t.tgrelid::regclass as table_name,t.tgname,t.tgenabled,p.oid::regprocedure as function,
  pg_get_triggerdef(t.oid) as trigger_definition,md5(p.prosrc) as function_body_md5
from pg_trigger t join pg_proc p on p.oid=t.tgfoid
where not t.tgisinternal and t.tgrelid in (to_regclass('public.unidades_condominio'),
  to_regclass('public.client_source_links'),to_regclass('public.client_reconciliation_candidate_sources'),
  to_regclass('public.client_reconciliation_candidates'),to_regclass('public.respond_identity_links'))
order by t.tgrelid::regclass::text,t.tgname;

with additions(table_name,column_name) as (values
  ('unidades_condominio','identity_owner_version'),
  ('client_source_links','condominium_id'),('client_source_links','source_version'),
  ('client_reconciliation_candidate_sources','condominium_id'),('client_reconciliation_candidate_sources','source_version'),
  ('client_reconciliation_candidates','respond_contact_id'),('client_reconciliation_candidates','evidence_version'),
  ('client_reconciliation_candidates','evidence_hash'),('client_reconciliation_candidates','respond_checked_at'))
select x.*,exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||x.table_name)
  and a.attname=x.column_name and a.attnum>0 and not a.attisdropped) as already_present,
  'must be absent before first installation; stop on any collision' as expectation
from additions x order by x.table_name,x.column_name;

select r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls
from pg_roles r where r.rolname in ('anon','authenticated','service_role',current_user) order by r.rolname;
select n.nspname,pg_get_userbyid(n.nspowner) as owner,n.nspacl,
  has_schema_privilege(current_user,n.oid,'CREATE') as operator_can_create,
  has_schema_privilege(current_user,n.oid,'USAGE') as operator_can_use
from pg_namespace n where n.nspname in ('public','extensions') order by n.nspname;
select e.extname,e.extversion,n.nspname as schema_name
from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';

select p.oid::regprocedure as function,r.rolname,
  has_function_privilege(r.oid,p.oid,'EXECUTE') as can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r
where n.nspname='public' and p.proname in ('confirm_client_reconciliation_candidate',
  'review_client_reconciliation_candidate','confirm_rental_client_candidate_v1','review_rental_client_candidate_v1',
  'confirm_exact_phone_respond_identity_link','confirm_exact_phone_respond_identity_link_core',
  'review_condominium_owner_identity') and r.rolname in ('anon','authenticated','service_role')
order by p.oid::regprocedure::text,r.rolname;

-- Do not read query text, application data, PII or connection credentials.
select l.relation::regclass as table_name,l.mode,l.granted,count(*) as lock_count
from pg_locks l where l.relation in (to_regclass('public.unidades_condominio'),
  to_regclass('public.condominios'),to_regclass('public.client_source_links'),
  to_regclass('public.client_reconciliation_candidate_sources'),
  to_regclass('public.client_reconciliation_candidates'),to_regclass('public.respond_identity_links'))
group by l.relation,l.mode,l.granted order by l.relation::regclass::text,l.mode,l.granted;
commit;
