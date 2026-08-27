import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  controlsForCondominium,
  filterRowsByCondominiumCapability,
  indexCondominiumOperationControls,
  resolveCondominiumOperationControls,
  unavailableCondominiumOperationControls,
} from "../lib/condominios/operationControls.mjs";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Tecaxco y un condominio operativo sin fila de control conservan comportamiento legacy", () => {
  const legacy = resolveCondominiumOperationControls(null);
  assert.deepEqual(legacy, {
    ownerPortalEnabled: true,
    communicationsEnabled: true,
    currentBillingEnabled: true,
    receiptsEnabled: true,
    realPaymentsEnabled: true,
    moneyMovementsEnabled: true,
    lifecycleStatus: "legacy_uncontrolled",
  });
  const index = indexCondominiumOperationControls([]);
  assert.deepEqual(controlsForCondominium(index, "tecaxco"), legacy);
  assert.deepEqual(controlsForCondominium(index, "operativo-generico"), legacy);
});

test("Génova en preimplementación bloquea las siete capacidades operativas", () => {
  const index = indexCondominiumOperationControls([{
    condominio_id: "genova",
    lifecycle_status: "preimplementation",
    owner_portal_enabled: false,
    communications_enabled: false,
    current_billing_enabled: false,
    receipts_enabled: false,
    real_payments_enabled: false,
    money_movements_enabled: false,
  }]);
  assert.deepEqual(controlsForCondominium(index, "genova"), {
    lifecycleStatus: "preimplementation",
    ownerPortalEnabled: false,
    communicationsEnabled: false,
    currentBillingEnabled: false,
    receiptsEnabled: false,
    realPaymentsEnabled: false,
    moneyMovementsEnabled: false,
  });
});

test("un error al cargar controles bloquea en vez de heredar defaults legacy", () => {
  assert.deepEqual(unavailableCondominiumOperationControls(), {
    ownerPortalEnabled: false,
    communicationsEnabled: false,
    currentBillingEnabled: false,
    receiptsEnabled: false,
    realPaymentsEnabled: false,
    moneyMovementsEnabled: false,
    lifecycleStatus: "controls_unavailable",
  });
});

test("cron excluye Génova sin alterar filas de Tecaxco u otro condominio operativo", () => {
  const index = indexCondominiumOperationControls([{
    condominio_id: "genova",
    lifecycle_status: "preimplementation",
    communications_enabled: false,
    current_billing_enabled: false,
  }]);
  const rows = [
    { id: "genova-fee", condominio_id: "genova" },
    { id: "tecaxco-fee", condominio_id: "tecaxco" },
    { id: "generic-fee", condominio_id: "operativo-generico" },
  ];
  assert.deepEqual(
    filterRowsByCondominiumCapability(rows, index, "communicationsEnabled").map((row) => row.id),
    ["tecaxco-fee", "generic-fee"],
  );
  assert.deepEqual(
    filterRowsByCondominiumCapability(rows, index, "currentBillingEnabled").map((row) => row.id),
    ["tecaxco-fee", "generic-fee"],
  );
  assert.equal(rows.length, 3);
});

test("UI muestra y aplica bloqueos de cuotas, pagos, recibos, comunicaciones y dinero", async () => {
  const [detail, list, portal, controlledPortal] = await Promise.all([
    readSource("../pages/condominio/[id].js"),
    readSource("../pages/condominios.js"),
    readSource("../pages/condomino.js"),
    readSource("../components/condomino/ControlledCondominoPortal.js"),
  ]);
  assert.match(detail, /operationControls\.currentBillingEnabled/);
  assert.match(detail, /operationControls\.realPaymentsEnabled/);
  assert.match(detail, /operationControls\.receiptsEnabled/);
  assert.match(detail, /operationControls\.communicationsEnabled/);
  assert.match(detail, /operationControls\.moneyMovementsEnabled/);
  assert.match(detail, /unavailableCondominiumOperationControls/);
  assert.match(list, /disabled=\{!cond\.operationControls\?\.currentBillingEnabled\}/);
  assert.match(portal, /condominium_owner_portal_units/);
  assert.match(controlledPortal, /condominium_owner_portal_snapshot/);
  assert.doesNotMatch(controlledPortal, /\.limit\(1\)/);
});

test("cron y endpoint de recibos fallan cerrado antes de efectos externos", async () => {
  const [cron, receipt] = await Promise.all([
    readSource("../pages/api/cron-recordatorios.js"),
    readSource("../pages/api/enviar-recibo-condominio.js"),
  ]);
  assert.ok(cron.indexOf('from("condominium_operation_controls")') < cron.indexOf('from("cuotas_condominio")'));
  assert.match(cron, /operationControlsError[\s\S]*status\(503\)/);
  assert.match(cron, /"currentBillingEnabled"/);
  assert.match(cron, /"communicationsEnabled"/);

  assert.ok(receipt.indexOf("authorizeCondominiumReceipt") < receipt.indexOf("resend.emails.send"));
  assert.ok(receipt.indexOf('from("condominium_operation_controls")') < receipt.indexOf("resend.emails.send"));
  assert.match(receipt, /!resolved\.receiptsEnabled \|\| !resolved\.communicationsEnabled/);
  assert.match(receipt, /auth\.getUser\(token\)/);
  assert.match(receipt, /\.eq\("id", cuotaId\)[\s\S]*\.eq\("condominio_id", condominioId\)/);
  assert.doesNotMatch(receipt, /json\(\{ error: error\.message \}\)/);
});
