import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "seed ficticio A/B P0.5",
  writeCapable: true,
});
const password = String(process.env.CONDOMINIOS_DEMO_PASSWORD || "");
if (password.length < 20) {
  throw new Error("CONDOMINIOS_DEMO_PASSWORD debe tener al menos 20 caracteres.");
}

const supabase = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const existing = await supabase
  .from("condominios")
  .select("id,nombre")
  .eq("notas", marker);
if (existing.error) throw existing.error;
if (existing.data?.length) {
  throw new Error("El seed P0.5 ya existe. Use primero el limpiador protegido.");
}

const userSpecs = [
  ["direccion", "global"],
  ["administrador_general", "global"],
  ["lider_cuenta", "a"],
  ["cobranza", "a"],
  ["mantenimiento", "a"],
  ["comite", "a"],
  ["condomino", "a"],
  ["solo_lectura", "a"],
  ["multiunidad", "a"],
  ["lider_cuenta", "b"],
  ["cobranza", "b"],
  ["comite", "b"],
  ["condomino", "b"],
  ["solo_lectura", "b"],
];
const users = new Map();
const listedUsers = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listedUsers.error) throw listedUsers.error;
const existingUsersByEmail = new Map(
  listedUsers.data.users
    .filter((user) => user.email)
    .map((user) => [user.email.toLowerCase(), user]),
);

for (const [role, scope] of userSpecs) {
  const key = `${role}:${scope}`;
  const email = `p05.${scope}.${role}@example.invalid`;
  const metadata = {
    demo_condominios: true,
    p05_marker: marker,
    rol_demo: role,
    scope_demo: scope,
  };
  const previous = existingUsersByEmail.get(email);
  const { data, error } = previous
    ? await supabase.auth.admin.updateUserById(previous.id, {
        password,
        email_confirm: true,
        user_metadata: metadata,
      })
    : await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      });
  if (error) throw error;
  users.set(key, data.user);
}

const internalProfiles = [...users.entries()]
  .filter(([key]) => !key.startsWith("condomino:") && !key.startsWith("multiunidad:"))
  .map(([key, user]) => ({
    id: user.id,
    email: user.email,
    full_name: `Usuario ficticio ${key}`,
    active: true,
    role_id: key.startsWith("solo_lectura:")
      ? "solo_lectura_demo"
      : "admin",
  }));
const profileResult = await supabase
  .from("profiles")
  .upsert(internalProfiles, { onConflict: "id" });
if (profileResult.error) throw profileResult.error;

const { data: condos, error: condoError } = await supabase
  .from("condominios")
  .insert([
    {
      nombre: "Condominio Demo A — Torres Ficticias",
      direccion: "Avenida Ficticia 100, Puebla",
      total_unidades: 60,
      cuota_mensual: 1450,
      honorarios_emporio: 8500,
      notas: marker,
      activo: true,
    },
    {
      nombre: "Condominio Demo B — Jardines Ficticios",
      direccion: "Calle Simulada 200, Puebla",
      total_unidades: 12,
      cuota_mensual: 980,
      honorarios_emporio: 4200,
      notas: marker,
      activo: true,
    },
  ])
  .select("*");
if (condoError) throw condoError;
const condoA = condos.find((item) => item.total_unidades === 60);
const condoB = condos.find((item) => item.total_unidades === 12);
if (!condoA || !condoB) throw new Error("No se distinguieron los condominios A/B.");

function buildUnits(condo, count, scope) {
  return Array.from({ length: count }, (_, index) => ({
    condominio_id: condo.id,
    numero: `${scope.toUpperCase()}-${String(index + 1).padStart(3, "0")}`,
    piso: String(Math.floor(index / 10) + 1),
    propietario_nombre: `Propietario Ficticio ${scope.toUpperCase()} ${index + 1}`,
    propietario_email: `p05.propietario.${scope}.${index + 1}@example.invalid`,
    propietario_telefono: `000-${scope === "a" ? "100" : "200"}-${String(index + 1).padStart(4, "0")}`,
    residente_nombre: index % 3 ? `Residente Ficticio ${scope.toUpperCase()} ${index + 1}` : null,
    residente_email: index % 3 ? `p05.residente.${scope}.${index + 1}@example.invalid` : null,
    residente_telefono: index % 3 ? `000-300-${String(index + 1).padStart(4, "0")}` : null,
    residente_es_propietario: index % 3 === 0,
    notas: marker,
    activo: true,
  }));
}

const { data: insertedUnits, error: unitError } = await supabase
  .from("unidades_condominio")
  .insert([...buildUnits(condoA, 60, "a"), ...buildUnits(condoB, 12, "b")])
  .select("id,condominio_id,numero");
if (unitError) throw unitError;
const unitsA = insertedUnits.filter((unit) => unit.condominio_id === condoA.id);
const unitsB = insertedUnits.filter((unit) => unit.condominio_id === condoB.id);

const memberships = [
  ["direccion:global", null, null, "direccion"],
  ["administrador_general:global", null, null, "administrador_general"],
  ["lider_cuenta:a", condoA.id, null, "lider_cuenta"],
  ["cobranza:a", condoA.id, null, "cobranza"],
  ["mantenimiento:a", condoA.id, null, "mantenimiento"],
  ["comite:a", condoA.id, null, "comite"],
  ["condomino:a", condoA.id, unitsA[0].id, "condomino"],
  ["solo_lectura:a", condoA.id, null, "solo_lectura"],
  ["multiunidad:a", condoA.id, unitsA[1].id, "condomino"],
  ["multiunidad:a", condoA.id, unitsA[2].id, "condomino"],
  ["lider_cuenta:b", condoB.id, null, "lider_cuenta"],
  ["cobranza:b", condoB.id, null, "cobranza"],
  ["comite:b", condoB.id, null, "comite"],
  ["condomino:b", condoB.id, unitsB[0].id, "condomino"],
  ["solo_lectura:b", condoB.id, null, "solo_lectura"],
].map(([key, condominioId, unidadId, role]) => ({
  user_id: users.get(key).id,
  condominio_id: condominioId,
  unidad_id: unidadId,
  rol: role,
  activo: true,
  created_by: users.get("direccion:global").id,
}));
const memberResult = await supabase.from("condominio_miembros").insert(memberships);
if (memberResult.error) throw memberResult.error;

function buildFees(condo, units, amount, creator) {
  return units.flatMap((unit, index) =>
    ["2026-05", "2026-06", "2026-07"].map((period, periodIndex) => {
      const pending = index % 7 === 0 && periodIndex === 2;
      return {
        condominio_id: condo.id,
        unidad_id: unit.id,
        periodo: period,
        monto: amount,
        status: pending ? "pendiente" : "pagado",
        fecha_vencimiento: `${period}-10`,
        fecha_pago: pending ? null : `${period}-${String(3 + (index % 6)).padStart(2, "0")}`,
        created_by: creator.id,
      };
    }),
  );
}
const { data: fees, error: feeError } = await supabase
  .from("cuotas_condominio")
  .insert([
    ...buildFees(condoA, unitsA, 1450, users.get("cobranza:a")),
    ...buildFees(condoB, unitsB, 980, users.get("cobranza:b")),
  ])
  .select("id,condominio_id,unidad_id,periodo,monto,status,fecha_pago");
if (feeError) throw feeError;

const payments = fees
  .filter((fee) => fee.status === "pagado")
  .map((fee) => ({
    condominio_id: fee.condominio_id,
    unidad_id: fee.unidad_id,
    cuota_id: fee.id,
    periodo: fee.periodo,
    monto: fee.monto,
    fecha_pago: fee.fecha_pago,
    metodo: "transferencia-demo",
    referencia: `P05-${fee.id.slice(0, 8)}`,
    notas: marker,
    created_by: fee.condominio_id === condoA.id
      ? users.get("cobranza:a").id
      : users.get("cobranza:b").id,
  }));
const paymentResult = await supabase.from("condominio_pagos").insert(payments);
if (paymentResult.error) throw paymentResult.error;

for (const condo of [condoA, condoB]) {
  const creator = condo.id === condoA.id ? users.get("cobranza:a") : users.get("cobranza:b");
  const condoFees = fees
    .filter((item) => item.condominio_id === condo.id && item.status === "pagado")
    .slice(0, 3);
  for (const fee of condoFees) {
    const pdf = new jsPDF();
    pdf.text("COMPROBANTE TOTALMENTE FICTICIO — P0.5", 20, 30);
    pdf.text(`Cuota demo: ${fee.id}`, 20, 45);
    const bytes = Buffer.from(pdf.output("arraybuffer"));
    const objectPath = `${condo.id}/comprobante_pago/p05/${fee.id}.pdf`;
    const upload = await supabase.storage
      .from("condominios-private")
      .upload(objectPath, bytes, { contentType: "application/pdf", upsert: false });
    if (upload.error) throw upload.error;
    const { data: document, error: documentError } = await supabase
      .from("condominio_documentos")
      .insert({
        condominio_id: condo.id,
        unidad_id: fee.unidad_id,
        categoria: "comprobante_pago",
        bucket: "condominios-private",
        object_path: objectPath,
        nombre_original: `p05-comprobante-ficticio-${fee.id}.pdf`,
        mime_type: "application/pdf",
        size_bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        created_by: creator.id,
      })
      .select("id")
      .single();
    if (documentError) throw documentError;
    const link = await supabase
      .from("cuotas_condominio")
      .update({ comprobante_documento_id: document.id })
      .eq("id", fee.id);
    if (link.error) throw link.error;
  }
}

const expenses = [
  [condoA, users.get("lider_cuenta:a"), "Agua ficticia A", 18200],
  [condoA, users.get("lider_cuenta:a"), "Limpieza ficticia A", 12500],
  [condoB, users.get("lider_cuenta:b"), "Jardinería ficticia B", 6400],
  [condoB, users.get("lider_cuenta:b"), "Vigilancia ficticia B", 9100],
].map(([condo, creator, concepto, monto], index) => ({
  condominio_id: condo.id,
  concepto,
  categoria: "operacion-demo",
  monto,
  fecha: `2026-07-${String(5 + index).padStart(2, "0")}`,
  notas: marker,
  created_by: creator.id,
}));
const expenseResult = await supabase.from("gastos_condominio").insert(expenses);
if (expenseResult.error) throw expenseResult.error;

const auditResult = await supabase.from("condominio_audit_log").insert([
  {
    actor_id: users.get("direccion:global").id,
    actor_role: "direccion",
    condominio_id: condoA.id,
    accion: "seed_demo",
    entidad: "condominios",
    entidad_id: condoA.id,
    origen: "seed-p05",
    metadata: { marker, scope: "A" },
  },
  {
    actor_id: users.get("direccion:global").id,
    actor_role: "direccion",
    condominio_id: condoB.id,
    accion: "seed_demo",
    entidad: "condominios",
    entidad_id: condoB.id,
    origen: "seed-p05",
    metadata: { marker, scope: "B" },
  },
]);
if (auditResult.error) throw auditResult.error;

console.log(JSON.stringify({
  ok: true,
  projectRef: config.projectRef,
  condominios: [
    { scope: "A", id: condoA.id, unidades: unitsA.length },
    { scope: "B", id: condoB.id, unidades: unitsB.length },
  ],
  usuarios_demo: users.size,
  membresias: memberships.length,
  cuotas: fees.length,
  pagos: payments.length,
  documentos_ficticios: 6,
  marker,
}, null, 2));
