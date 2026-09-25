-- DEV only. Disable invitation flag before rollback. Existing legacy links remain valid.
begin;
drop function public.blindaje_link_invited_submission(text,text,uuid);
drop table public.blindaje_partner_invitations;
commit;
