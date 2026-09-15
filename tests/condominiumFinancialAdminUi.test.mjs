import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api=readFileSync(new URL("../pages/api/condominios/financial-core.js",import.meta.url),"utf8");
const ui=readFileSync(new URL("../components/condominios/FinancialAdminPanel.js",import.meta.url),"utf8");
const page=readFileSync(new URL("../pages/condominio/[id].js",import.meta.url),"utf8");

test("la ficha añade Finanzas sin sustituir Cartera ni Estado de cuenta",()=>{
  assert.match(page,/id: "finanzas"/);
  assert.match(page,/id: "cartera"/);
  assert.match(page,/id: "estado_cuenta"/);
  assert.match(page,/FinancialAdminPanel condominioId=\{id\}/);
});

test("estado inactivo es explícito y no ofrece activación",()=>{
  assert.match(ui,/Financial Core aún no está activado para este condominio/);
  assert.doesNotMatch(ui,/activar-ledger|enable-ledger|Activar Financial Core/);
});

test("navegación cubre las siete superficies autorizadas",()=>{
  for(const label of ["Resumen","Cargos","Ingresos","Aplicaciones","No identificados","Libro banco","Fondos"]) assert.match(ui,new RegExp(`\\"${label}\\"`));
});

test("lectura y evidencia se autorizan server-side y se limitan por condominio",()=>{
  assert.match(api,/clients\(req,req\.method===\"POST\"\)/);
  assert.match(api,/\.eq\(\"condominio_id\",condominioId\)/);
  assert.match(api,/createSignedUrl\(receipt\.evidence_path,60\)/);
  assert.match(api,/evidence_path:undefined/);
});

test("referencias sensibles se enmascaran antes de llegar al cliente",()=>{
  assert.match(api,/return `••••\$\{text\.slice\(-4\)\}`/);
  assert.match(api,/bank_reference:maskReference/);
  assert.match(api,/payer_reference:maskReference/);
});

test("las métricas UI se derivan de cargos, aplicaciones conciliadas y ledger",()=>{
  assert.match(ui,/reconciledReceiptIds/);
  assert.match(ui,/appliedByCharge/);
  assert.match(ui,/ledgerBalances/);
  assert.doesNotMatch(ui,/fondoDisponible/);
  assert.doesNotMatch(ui,/cuotas_condominio|gastos_condominio|condominium_historical/);
});

test("identificación posterior usa el RPC existente y nunca edita el movimiento",()=>{
  assert.match(ui,/action:\"identify-bank-transaction\"/);
  assert.match(ui,/El movimiento original no se modifica destructivamente/);
  assert.doesNotMatch(ui,/\.from\(\"condominium_bank_transactions\"\).*update/s);
});

test("errores distinguen sesión, autorización y backend",()=>{
  assert.match(ui,/status===403/);
  assert.match(ui,/status===401/);
  assert.match(ui,/No fue posible cargar Finanzas/);
});

test("el endpoint mantiene mutaciones con puede_editar y lectura con puede_ver",()=>{
  assert.match(api,/requireEdit = true/);
  assert.match(api,/permission\?\.puede_ver!==true\|\|\(requireEdit&&permission\?\.puede_editar!==true\)/);
});
