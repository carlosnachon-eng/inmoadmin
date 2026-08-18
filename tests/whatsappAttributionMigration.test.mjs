import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/202608140001_whatsapp_attribution.sql", import.meta.url),
  "utf8",
);

test("migración es productiva, aditiva y no toca la infraestructura Respond.io canónica", () => {
  assert.match(migration, /^-- Web -> WhatsApp -> Respond\.io attribution/m);
  assert.doesNotMatch(migration, /DEV ONLY|hjfwjnejbcpmknvfpdcq|emporio_web_preview/);
  assert.doesNotMatch(migration, /gv_respond_webhook_events|gv_respond_contact_snapshots|maintenance_tickets|gv_opportunit/i);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
});

test("tablas no exponen acceso a PUBLIC, anon o authenticated", () => {
  for (const table of ["whatsapp_attributions", "whatsapp_attribution_events"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.doesNotMatch(migration, /create policy/i);
});

test("RPCs son SECURITY DEFINER, search_path fijo y solo service_role", () => {
  for (const name of [
    "create_whatsapp_attribution_click",
    "observe_whatsapp_attribution_message",
    "purge_whatsapp_attribution_retention",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`));
  }
  assert.equal((migration.match(/security definer/gi) || []).length, 3);
  assert.equal((migration.match(/set search_path = pg_catalog, public/gi) || []).length, 4);
});

test("referencia, idempotencia, expiración, retención, replay y rate limit están modelados", () => {
  assert.match(migration, /request_id uuid not null unique/);
  assert.match(migration, /reference_code text not null unique/);
  assert.match(migration, /interval '7 days'/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /status in \('clicked', 'message_observed', 'contact_linked', 'expired', 'invalid'\)/);
  assert.match(migration, /duplicate_event/);
  assert.match(migration, /replay_rejected/);
  assert.match(migration, /then 'replayed'[\s\S]*else 'invalid'/);
  assert.match(migration, /pg_advisory_xact_lock\(20260814, 1\)/);
  assert.match(migration, /attribution_rate_limited/);
  assert.match(migration, /purge_whatsapp_attribution_retention/);
});

test("historial es inmutable salvo purga de retención controlada", () => {
  assert.match(migration, /before update or delete on public\.whatsapp_attribution_events/);
  assert.match(migration, /app\.whatsapp_attribution_retention_purge/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*authenticated/i);
});

test("no existe columna para cuerpo de mensaje ni PII de contacto", () => {
  assert.doesNotMatch(migration, /\b(message_body|message_text|phone|telefono|email|contact_name|nombre)\b/i);
  assert.match(migration, /linked_message_id text/);
  assert.match(migration, /page_origin = 'emporio_web'/);
});

test("múltiples intenciones por contacto y un solo vínculo por evento permanecen posibles", () => {
  assert.doesNotMatch(migration, /unique\s*\(respond_contact_id\)/i);
  assert.match(migration, /linked_webhook_event_id text unique/);
  assert.match(migration, /whatsapp_attribution_events_webhook_type_uidx/);
});
