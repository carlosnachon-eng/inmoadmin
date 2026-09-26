-- DEV only. Remove proof objects through Storage API first; refuse a nonempty bucket.
begin;
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'blindaje-payment-proofs') then
    raise exception 'Remove DEV proof objects via Storage API before rollback';
  end if;
end $$;
delete from storage.buckets where id = 'blindaje-payment-proofs';
drop function public.blindaje_receive_payment_proof(text,text,text,text,text,text,text);
drop function public.blindaje_bootstrap_external_payment(text,text,text,text);
drop trigger blindaje_preserve_claim on public.solicitudes_inquilino;
drop trigger blindaje_preserve_claim on public.propietarios_inmuebles;
drop function public.blindaje_preserve_submission_claim();
alter table public.solicitudes_inquilino drop column blindaje_submission_claim_hash;
alter table public.propietarios_inmuebles drop column blindaje_submission_claim_hash;
drop table public.blindaje_case_access_tokens, public.blindaje_b2c_submission_tokens, public.blindaje_investigation_payments, public.blindaje_external_cases;
drop sequence public.blindaje_external_folio_seq;
commit;
