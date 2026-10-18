-- Preserve existing DM credentials; allow the explicit comments upgrade.
-- No credential values, ACLs, RLS policies or sender gates are changed.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
alter table instagram_business_private.credentials
  drop constraint credentials_scopes_check;
alter table instagram_business_private.credentials
  add constraint credentials_scopes_check check (
    array_ndims(scopes) = 1 and array_position(scopes, null) is null and (
      (cardinality(scopes) = 2
       and scopes @> array['instagram_business_basic','instagram_business_manage_messages']::text[]
       and scopes <@ array['instagram_business_basic','instagram_business_manage_messages']::text[])
      or
      (cardinality(scopes) = 3
       and scopes @> array['instagram_business_basic','instagram_business_manage_messages','instagram_business_manage_comments']::text[]
       and scopes <@ array['instagram_business_basic','instagram_business_manage_messages','instagram_business_manage_comments']::text[])
    )
  );
commit;
