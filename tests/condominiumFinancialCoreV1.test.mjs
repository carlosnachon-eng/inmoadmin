import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { financialErrorCode, financialEvidence, validateFinancialAction } from "../lib/condominios/financialCore.mjs";

const migration=fs.readFileSync(new URL("../supabase/migrations/202609140001_condominium_financial_core_v1.sql",import.meta.url),"utf8");
const rollback=fs.readFileSync(new URL("../supabase/production/rollback/202609140001_condominium_financial_core_v1_rollback.sql",import.meta.url),"utf8");
const endpoint=fs.readFileSync(new URL("../pages/api/condominios/financial-core.js",import.meta.url),"utf8");
const tables=["funds","bank_accounts","charge_concepts","charges","bank_transactions","receipts","payment_applications","bank_matches","reconciliations","financial_periods","financial_events","journal_entries","journal_lines"];

test("foundation is additive and all real condominiums remain inactive",()=>{
  assert.match(migration,/ledger_enabled boolean not null default false/);
  assert.doesNotMatch(migration,/insert into public\.condominium_financial_controls/i);
  assert.doesNotMatch(migration,/alter table public\.(cuotas_condominio|gastos_condominio)/i);
  for(const name of tables) assert.match(migration,new RegExp(`create table public\\.condominium_${name}`));
});

test("ledger is balanced, posted transactionally and append-only",()=>{
  assert.match(migration,/if d<=0 or d<>c then raise exception/);
  assert.match(migration,/FINANCIAL_HISTORY_IS_APPEND_ONLY/);
  assert.match(migration,/operation_reversed/);
  assert.match(migration,/values\(p_condominio_id,e\.id,l\.line_no,l\.account_code,l\.bank_account_id,l\.fund_id,l\.unidad_id,l\.charge_id,l\.credit,l\.debit\)/);
});

test("receipt applications are N:M and cannot exceed receipt or charge",()=>{
  assert.match(migration,/APPLICATION_EXCEEDS_RECEIPT_AVAILABLE/);
  assert.match(migration,/APPLICATION_EXCEEDS_CHARGE_BALANCE/);
  assert.match(migration,/unique\(receipt_id,charge_id\)/);
  assert.match(migration,/jsonb_array_elements\(p_applications\)/);
});

test("tenant isolation, RLS and private evidence fail closed",()=>{
  assert.match(migration,/force row level security/i);
  assert.match(migration,/CONDOMINIUM_LEDGER_INACTIVE/);
  assert.match(migration,/foreign key\(fund_id,condominio_id\)/);
  assert.match(migration,/condominium-financial-evidence','condominium-financial-evidence',false,5242880/);
  assert.doesNotMatch(migration,/create policy[^;]+storage\.objects/is);
});

test("endpoint keeps privileged key server-side and requires a real session",()=>{
  assert.match(endpoint,/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(endpoint,/NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(endpoint,/serviceDb\.auth\.getUser\(token\)/);
  assert.match(endpoint,/operatorDb\.rpc/);
});

test("rollback is fail-closed once financial activity or evidence exists",()=>{
  assert.match(rollback,/FINANCIAL_CORE_ROLLBACK_BLOCKED_ACTIVITY/);
  assert.match(rollback,/FINANCIAL_CORE_ROLLBACK_BLOCKED_EVIDENCE_EXISTS/);
  assert.match(rollback,/REQUIRES_EMPTY_BUCKET_REMOVAL_VIA_STORAGE_API/);
});

test("evidence accepts only certified private formats",()=>{
  const pdf=financialEvidence({mimeType:"application/pdf",base64:Buffer.from("%PDF-1.4 QA").toString("base64")});
  assert.equal(pdf.extension,"pdf");
  assert.equal(financialEvidence({mimeType:"text/plain",base64:"YQ=="}),null);
});

test("input validation and safe error mapping",()=>{
  const id="11111111-1111-4111-8111-111111111111";
  assert.equal(validateFinancialAction("create-charge",{id,condominioId:id,unidadId:id,conceptId:id,periodId:id,idempotencyKey:id}),null);
  assert.equal(validateFinancialAction("create-charge",{}),"INVALID_CONDOMINIUM");
  assert.equal(financialErrorCode({message:"APPLICATION_EXCEEDS_RECEIPT_AVAILABLE"}),"AMOUNT_EXCEEDS_AVAILABLE");
  assert.equal(financialErrorCode({message:"secret database detail"}),"FINANCIAL_OPERATION_FAILED");
});
