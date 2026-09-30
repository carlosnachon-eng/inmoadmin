alter table public.shadow_media_interpretations
  drop constraint if exists shadow_media_interpretations_runtime_version_check,
  drop constraint if exists shadow_media_interpretations_media_type_check;

alter table public.shadow_media_interpretations
  add constraint shadow_media_interpretations_runtime_version_check
    check(runtime_version ~ '^shadow-media-(vision|document)-v[0-9]+$'),
  add constraint shadow_media_interpretations_media_type_check
    check(media_type in ('image','document'));
