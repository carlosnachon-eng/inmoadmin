-- RLS and row triggers do not protect TRUNCATE. API roles need only DML.
revoke truncate, references, trigger on public.cierres from public, anon, authenticated;
revoke truncate, references, trigger on public.cierre_pagos from public, anon, authenticated;
