begin;
alter table instagram_observer_private.events
  drop constraint events_native_id_check,
  drop constraint events_media_id_check,
  drop constraint events_parent_id_check,
  add constraint events_native_id_check check (length(native_id) between 1 and 512 and native_id ~ '^[A-Za-z0-9_.:=-]+$'),
  add constraint events_media_id_check check (length(media_id) between 1 and 512 and media_id ~ '^[A-Za-z0-9_.:=-]+$'),
  add constraint events_parent_id_check check (length(parent_id) between 1 and 512 and parent_id ~ '^[A-Za-z0-9_.:=-]+$');
commit;
