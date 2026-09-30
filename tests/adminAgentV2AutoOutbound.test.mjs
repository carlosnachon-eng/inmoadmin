import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAdminAgentV2AutoOutboundEnvironment,
  isSafeContractEndDateMessage,
} from "../lib/agentsV2/autoOutbound.js";

test("contract end-date intent is narrowly allowlisted", () => {
  assert.equal(isSafeContractEndDateMessage("¿Cuándo termina mi contrato?"), true);
  assert.equal(isSafeContractEndDateMessage("Qué fecha vence mi arrendamiento"), true);
  assert.equal(isSafeContractEndDateMessage("Quiero cancelar mi contrato antes"), false);
  assert.equal(isSafeContractEndDateMessage("¿Me regresan el depósito al terminar el contrato?"), false);
  assert.equal(isSafeContractEndDateMessage("¿Tienen registrado mi pago?"), false);
});

test("auto outbound fails closed unless explicitly enabled in production", () => {
  const base={
    ADMIN_AGENT_V2_AUTO_OUTBOUND_ENABLED:"true",
    ADMIN_AGENT_V2_AUTO_OUTBOUND_NOT_BEFORE:"2026-09-30T23:00:00Z",
    VERCEL_ENV:"production",
    SUPABASE_ENVIRONMENT:"production",
    SHADOW_OUTBOUND_ENABLED:"false",
    SHADOW_ADMIN_OUTBOUND_ENABLED:"false",
    RESPOND_IO_TOKEN:"test",
  };
  assert.doesNotThrow(()=>assertAdminAgentV2AutoOutboundEnvironment(base));
  assert.throws(()=>assertAdminAgentV2AutoOutboundEnvironment({...base,ADMIN_AGENT_V2_AUTO_OUTBOUND_ENABLED:"false"}),/disabled/);
  assert.throws(()=>assertAdminAgentV2AutoOutboundEnvironment({...base,SHADOW_OUTBOUND_ENABLED:"true"}),/legacy_outbound/);
  assert.throws(()=>assertAdminAgentV2AutoOutboundEnvironment({...base,VERCEL_ENV:"preview"}),/environment_mismatch/);
  assert.throws(()=>assertAdminAgentV2AutoOutboundEnvironment({...base,ADMIN_AGENT_V2_AUTO_OUTBOUND_NOT_BEFORE:""}),/cutoff_invalid/);
});
