import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bootstrap = await readFile(
  new URL("../supabase/dev/bootstrap/202608140001_whatsapp_attribution_pilot.sql", import.meta.url),
  "utf8",
);

test("bootstrap está marcado DEV ONLY y no es migración productiva", () => {
  assert.match(bootstrap, /^-- DEV ONLY\./);
  assert.match(bootstrap, /hjfwjnejbcpmknvfpdcq/);
  assert.doesNotMatch(bootstrap, /bnzrnizrmonjxlktbhlp/);
});

test("tablas no exponen acceso a PUBLIC, anon o authenticated", () => {
  for (const table of ["whatsapp_attributions", "whatsapp_attribution_events"]) {
    assert.match(bootstrap, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(bootstrap, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.doesNotMatch(bootstrap, /create policy/i);
});

test("RPCs son SECURITY DEFINER, scoped a service_role y atómicas", () => {
  assert.match(bootstrap, /create or replace function public\.create_whatsapp_attribution_click/);
  assert.match(bootstrap, /create or replace function public\.observe_whatsapp_attribution_message/);
  assert.equal((bootstrap.match(/security definer/gi) || []).length, 2);
  assert.match(bootstrap, /set search_path = pg_catalog, public/g);
  assert.match(bootstrap, /grant execute[\s\S]*to service_role/g);
  assert.match(bootstrap, /^begin;/m);
  assert.match(bootstrap, /commit;\s*$/);
});

test("referencia, idempotencia, expiración, replay e historial inmutable están modelados", () => {
  assert.match(bootstrap, /request_id uuid not null unique/);
  assert.match(bootstrap, /reference_code text not null unique/);
  assert.match(bootstrap, /interval '7 days'/);
  assert.match(bootstrap, /interval '90 days'/);
  assert.match(bootstrap, /duplicate_event/);
  assert.match(bootstrap, /replay_rejected/);
  assert.match(bootstrap, /before update or delete on public\.whatsapp_attribution_events/);
});

test("no existe columna para cuerpo de mensaje ni PII de contacto", () => {
  assert.doesNotMatch(bootstrap, /\b(message_body|message_text|phone|telefono|email|contact_name|nombre)\b/i);
  assert.match(bootstrap, /linked_message_id text/);
});
