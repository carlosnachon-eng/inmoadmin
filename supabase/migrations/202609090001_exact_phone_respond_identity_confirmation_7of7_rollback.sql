-- Rollback de código/esquema solamente. No revierte confirmaciones ni elimina evidencia.
begin;
drop function if exists public.confirm_exact_phone_respond_identity_link(text,uuid,text,text,timestamptz,text,text,uuid);
drop function if exists public.confirm_exact_phone_respond_identity_link_core(text,uuid,text,text,timestamptz,text,text,uuid);
drop index if exists public.respond_identity_links_confirmed_identity_uidx;
drop index if exists public.respond_identity_audit_exact_phone_evidence_uidx;
commit;
