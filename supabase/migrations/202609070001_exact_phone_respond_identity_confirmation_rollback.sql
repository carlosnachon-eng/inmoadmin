begin;
drop function if exists public.confirm_exact_phone_respond_identity_link(uuid,text,text,timestamptz,text,text,uuid);
drop index if exists public.respond_identity_audit_exact_phone_evidence_uidx;
commit;
