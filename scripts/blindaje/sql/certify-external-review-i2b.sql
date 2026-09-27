-- DEV synthetic existing fixture; every change in this certification is rolled back.
begin;
set local role service_role;
do $$
declare p public.blindaje_investigation_payments; c public.blindaje_external_cases;
 actor uuid := gen_random_uuid(); before_count bigint; result text; token_hash text := encode(extensions.digest('I2B-QA rollback token','sha256'),'hex');
 original_path text; new_path text;
begin
 select e.* into c from public.blindaje_external_cases e join public.solicitudes_inquilino s on s.id=e.solicitud_inquilino_id where s.nombre_completo like 'I2A-QA%' and e.status in ('awaiting_payment','proof_received','payment_rejected') limit 1;
 assert c.id is not null, 'existing DEV synthetic proof fixture required';
 select * into p from public.blindaje_investigation_payments where case_id=c.id;
 original_path := p.proof_storage_path;
 insert into public.blindaje_case_access_tokens(case_id,token_hash,expires_at) values(c.id,token_hash,now()+interval '1 hour');
 if p.status <> 'proof_received' then
   new_path := 'cases/'||c.id||'/investigation/'||p.id||'/'||gen_random_uuid()||'.pdf';
   assert public.blindaje_receive_payment_proof(token_hash,original_path,new_path,'application/pdf','I2B-QA.pdf','inquilino',null);
   original_path := new_path;
 end if;
 select count(*) into before_count from public.poliza_caja;
 result := public.blindaje_review_investigation_payment(p.id,'reject',actor,'I2B-QA','El comprobante no permite verificar el pago.');
 assert result='rejected';
 assert (select count(*)=before_count from public.poliza_caja);
 assert not exists(select 1 from public.blindaje_investigation_ledger_entries where payment_id=p.id);
 assert public.blindaje_review_investigation_payment(p.id,'reject',actor,'I2B-QA','Motivo neutral.')='rejected';
 assert public.blindaje_review_investigation_payment(p.id,'validate',actor,'I2B-QA',null) is null;

 new_path := 'cases/'||c.id||'/investigation/'||p.id||'/'||gen_random_uuid()||'.pdf';
 assert not public.blindaje_receive_payment_proof(token_hash,'wrong-path',new_path,'application/pdf','I2B-QA.pdf','inquilino',null);
 assert public.blindaje_receive_payment_proof(token_hash,original_path,new_path,'application/pdf','I2B-QA.pdf','inquilino',null);
 assert (select status='proof_received' and rejected_at is null and rejected_by is null and rejection_reason is null from public.blindaje_investigation_payments where id=p.id);
 assert public.blindaje_review_investigation_payment(p.id,'validate',actor,'I2B-QA',null)='validated';
 assert public.blindaje_review_investigation_payment(p.id,'validate',actor,'I2B-QA',null)='validated';
 assert (select count(*)=before_count+1 from public.poliza_caja);
 assert (select count(*)=1 from public.blindaje_investigation_ledger_entries where payment_id=p.id);
 assert (select status='payment_validated' and folio=c.folio from public.blindaje_external_cases where id=c.id);
 assert (select cobro_investigacion and monto_investigacion=1000 and metodo_cobro_investigacion='transferencia' and fecha_cobro_investigacion=(now() at time zone 'America/Mexico_City')::date from public.solicitudes_inquilino where id=c.solicitud_inquilino_id);
 assert public.blindaje_review_investigation_payment(p.id,'reject',actor,'I2B-QA','Motivo neutral.') is null;
 assert not public.blindaje_receive_payment_proof(token_hash,new_path,original_path,'application/pdf','I2B-QA.pdf','inquilino',null);
end $$;
rollback;
select 'I2B reject/replacement/validate/retry/immutable validated PASS (rolled back)' result;
