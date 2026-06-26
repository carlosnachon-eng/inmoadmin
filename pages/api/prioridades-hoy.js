import { createClient } from "@supabase/supabase-js";
import {
  crearPendiente,
  diasEntreFechas,
  horasDesde,
  horasHasta,
  ordenarPrioridades,
  resumenDeterminista,
} from "../../lib/prioridadesHoy";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CACHE_TTL = 30 * 60 * 1000;
const CACHE_TTL_OTROS_ROLES = 24 * 60 * 60 * 1000;
const cache = globalThis.__prioridadesHoyCache || new Map();
globalThis.__prioridadesHoyCache = cache;

const hoyMexico = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const nombrePerfil = (perfil) => perfil?.full_name || perfil?.email || "Asesor";
const nombreRelacionado = (relacion, respaldo) => {
  const perfil = Array.isArray(relacion) ? relacion[0] : relacion;
  return perfil?.full_name || perfil?.email || respaldo;
};
const normalizarTexto = (valor) => String(valor || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

const solicitudSigueAbierta = (status) => {
  const valor = normalizarTexto(status);
  return !valor || ["pendiente", "en_revision"].includes(valor);
};

const nombresCoinciden = (a, b) => {
  const uno = normalizarTexto(a);
  const dos = normalizarTexto(b);
  if (!uno || !dos || Math.min(uno.length, dos.length) < 8) return false;
  return uno === dos || uno.includes(dos) || dos.includes(uno);
};

const firmaCierraSolicitud = (firma, solicitud) => {
  if (!firma || !solicitud) return false;
  const nombreSolicitud = solicitud.nombre_completo || solicitud.razon_social;
  const coincideSolicitante = nombresCoinciden(nombreSolicitud, firma.nombre_comprador)
    || nombresCoinciden(nombreSolicitud, firma.titulo);
  if (!coincideSolicitante) return false;
  const statusFirma = normalizarTexto(firma.status);
  const etapaActual = Number(firma.etapa_actual) || 0;
  return statusFirma === "completado" || etapaActual >= 12;
};

async function autenticar(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { error: "Sesión requerida", status: 401 };

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: "Sesión inválida", status: 401 };

  const { data: perfil, error: perfilError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role_id")
    .eq("id", user.id)
    .maybeSingle();

  if (perfilError || !perfil) return { error: "Perfil no encontrado", status: 403 };
  return { user, perfil };
}

const dominiosPorRol = (rol) => {
  if (rol === "admin") return ["administracion", "juridico", "comercial"];
  if (rol === "coord_operaciones") return ["administracion"];
  if (rol === "juridico") return ["juridico"];
  if (["asesor", "gerente_ventas"].includes(rol)) return ["comercial"];
  return [];
};

async function resumenClaude(pendientes) {
  if (!pendientes.length || !process.env.ANTHROPIC_API_KEY) {
    return resumenDeterminista(pendientes);
  }

  const datos = pendientes.map(({ nivel, titulo, motivo, responsable, modulo }) => ({
    nivel,
    titulo,
    motivo,
    responsable,
    modulo,
  }));

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        temperature: 0,
        messages: [{
          role: "user",
          content: `Resume para un colaborador de Emporio qué debe atender hoy.
Usa máximo 4 líneas, español claro y accionable. No inventes datos, no cambies prioridades y no emitas predicciones.
Pendientes seleccionados:
${JSON.stringify(datos)}`,
        }],
      }),
    });

    if (!response.ok) throw new Error("Claude no disponible");
    const data = await response.json();
    const texto = data?.content?.find((item) => item.type === "text")?.text?.trim();
    return texto || resumenDeterminista(pendientes);
  } catch {
    return resumenDeterminista(pendientes);
  }
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Método no permitido" });
  }

  const auth = await autenticar(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const esAdmin = auth.perfil.role_id === "admin";
  const forzarSolicitado = req.query.force === "1" || req.body?.force === true;
  const forzar = esAdmin && forzarSolicitado;
  const cacheKey = auth.user.id;
  const cacheado = cache.get(cacheKey);
  if (!forzar && cacheado && cacheado.expira > Date.now()) {
    return res.status(200).json({
      ...cacheado.data,
      desdeCache: true,
      puedeForzar: esAdmin,
    });
  }

  const ahora = new Date();
  const hoy = hoyMexico();
  const dominios = dominiosPorRol(auth.perfil.role_id);
  const candidatos = [];
  const fuentesConError = [];

  const safe = async (nombre, consulta) => {
    try {
      const resultado = await consulta;
      if (resultado.error) {
        fuentesConError.push(nombre);
        return [];
      }
      return resultado.data || [];
    } catch {
      fuentesConError.push(nombre);
      return [];
    }
  };

  if (dominios.includes("administracion")) {
    const [pagos, contratos, mantenimientos] = await Promise.all([
      safe("Cobranza", supabase
        .from("payments")
        .select("id, tenant_name, property_name, amount, due_date, status, created_at")
        .in("status", ["pendiente", "atrasado"])),
      safe("Renovaciones", supabase
        .from("contracts")
        .select("id, tenant_name, property_name, end_date, status")
        .eq("status", "activo")),
      safe("Mantenimientos", supabase
        .from("maintenance_tickets")
        .select("id, property_name, tenant_name, title, priority, status, created_at, updated_at")
        .not("status", "in", '("cerrado","cancelado","resuelto")')),
    ]);

    pagos.forEach((pago) => {
      const diasAtraso = diasEntreFechas(pago.due_date, hoy);
      const monto = Number(pago.amount) || 0;
      if (pago.status === "atrasado" && diasAtraso > 0) {
        const nivel = diasAtraso >= 10 || monto >= 15000 ? "P0" : "P1";
        candidatos.push(crearPendiente({
          id: `cobranza-${pago.id}`,
          nivel,
          titulo: `Cobranza vencida: ${pago.tenant_name || pago.property_name || "renta pendiente"}`,
          motivo: `${diasAtraso} día${diasAtraso === 1 ? "" : "s"} de atraso · ${monto.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}`,
          responsable: "Administración",
          modulo: "Cobranza",
          href: "/cobranza",
          fechaReferencia: pago.due_date,
          monto,
          puntos: (diasAtraso >= 10 ? 30 : 0) + (monto >= 15000 ? 30 : 0),
        }));
      } else if (pago.status === "pendiente" && diasAtraso === 0) {
        candidatos.push(crearPendiente({
          id: `cobranza-${pago.id}`,
          nivel: "P1",
          titulo: `Cobro vence hoy: ${pago.tenant_name || pago.property_name || "renta pendiente"}`,
          motivo: `Pago pendiente por ${monto.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}`,
          responsable: "Administración",
          modulo: "Cobranza",
          href: "/cobranza",
          fechaReferencia: pago.due_date,
          monto,
          puntos: 10 + (monto >= 15000 ? 30 : 0),
        }));
      }
    });

    contratos.forEach((contrato) => {
      const dias = diasEntreFechas(hoy, contrato.end_date);
      if (dias === null || dias > 30) return;
      const nivel = dias <= 15 ? "P0" : "P1";
      candidatos.push(crearPendiente({
        id: `renovacion-${contrato.id}`,
        nivel,
        titulo: `Renovación: ${contrato.property_name || contrato.tenant_name || "contrato"}`,
        motivo: dias < 0
          ? `Contrato activo vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"}`
          : `Vence en ${dias} día${dias === 1 ? "" : "s"}`,
        responsable: "Administración",
        modulo: "Renovaciones",
        href: "/contratos",
        fechaReferencia: contrato.end_date,
        puntos: 20 + (dias <= 0 ? 30 : 0),
      }));
    });

    mantenimientos.forEach((ticket) => {
      const sinMovimiento = horasDesde(ticket.updated_at || ticket.created_at, ahora);
      const prioridad = String(ticket.priority || "").toLowerCase();
      let nivel = null;
      let motivo = "";
      let puntos = 0;
      if (prioridad === "urgente" || sinMovimiento >= 72) {
        nivel = "P0";
        motivo = prioridad === "urgente"
          ? `Ticket urgente abierto${sinMovimiento ? ` · ${Math.floor(sinMovimiento)} h sin movimiento` : ""}`
          : `${Math.floor(sinMovimiento)} horas sin movimiento`;
        puntos = 30 + (sinMovimiento >= 72 ? 20 : 0);
      } else if (prioridad === "alta" || sinMovimiento >= 24) {
        nivel = "P1";
        motivo = prioridad === "alta"
          ? `Mantenimiento de prioridad alta${sinMovimiento ? ` · ${Math.floor(sinMovimiento)} h abierto` : ""}`
          : `${Math.floor(sinMovimiento)} horas sin movimiento`;
        puntos = prioridad === "alta" ? 20 : 10;
      }
      if (!nivel) return;
      candidatos.push(crearPendiente({
        id: `mantenimiento-${ticket.id}`,
        nivel,
        titulo: ticket.title || `Mantenimiento: ${ticket.property_name || "propiedad"}`,
        motivo,
        responsable: "Administración",
        modulo: "Mantenimiento",
        href: "/mantenimiento",
        fechaReferencia: ticket.updated_at || ticket.created_at,
        puntos,
      }));
    });
  }

  if (dominios.includes("comercial")) {
    const propio = auth.perfil.role_id !== "admin";
    let citasQuery = supabase
      .from("citas")
      .select("id, cliente_id, fecha_hora, estado, asesor_id, clientes(nombre), profiles:asesor_id(full_name, email)")
      .eq("estado", "agendada");
    let clientesQuery = supabase
      .from("clientes")
      .select("id, nombre, etapa_interes, asesor_id, created_at, updated_at, profiles:asesor_id(full_name, email)")
      .not("etapa_interes", "in", '("perdido","cerrado")');
    let seguimientosQuery = supabase
      .from("seguimientos_cliente")
      .select("id, cliente_id, asesor_id, created_at");

    if (propio) {
      citasQuery = citasQuery.eq("asesor_id", auth.perfil.id);
      clientesQuery = clientesQuery.eq("asesor_id", auth.perfil.id);
      seguimientosQuery = seguimientosQuery.eq("asesor_id", auth.perfil.id);
    }

    const [citas, clientes, seguimientos] = await Promise.all([
      safe("Citas", citasQuery),
      safe("Clientes", clientesQuery),
      safe("Seguimientos", seguimientosQuery),
    ]);

    const citasPorCliente = {};
    citas.forEach((cita) => {
      if (!citasPorCliente[cita.cliente_id]) citasPorCliente[cita.cliente_id] = [];
      citasPorCliente[cita.cliente_id].push(cita);
      const horas = horasHasta(cita.fecha_hora, ahora);
      const responsable = nombreRelacionado(cita.profiles, nombrePerfil(auth.perfil));
      if (horas !== null && horas < 0) {
        candidatos.push(crearPendiente({
          id: `cita-${cita.id}`,
          nivel: "P0",
          titulo: `Cita vencida: ${cita.clientes?.nombre || "cliente"}`,
          motivo: `Sigue agendada ${Math.max(1, Math.floor(Math.abs(horas)))} h después de su hora`,
          responsable,
          modulo: "Citas",
          href: "/clientes",
          fechaReferencia: cita.fecha_hora,
          puntos: 30,
        }));
      } else if (horas !== null && horas <= 24) {
        candidatos.push(crearPendiente({
          id: `cita-${cita.id}`,
          nivel: "P1",
          titulo: `Cita próxima: ${cita.clientes?.nombre || "cliente"}`,
          motivo: `Agendada dentro de las próximas ${Math.max(1, Math.ceil(horas))} horas`,
          responsable,
          modulo: "Citas",
          href: "/clientes",
          fechaReferencia: cita.fecha_hora,
          puntos: 10,
        }));
      }
    });

    const ultimoSeguimiento = {};
    seguimientos.forEach((item) => {
      if (!ultimoSeguimiento[item.cliente_id] || new Date(item.created_at) > new Date(ultimoSeguimiento[item.cliente_id])) {
        ultimoSeguimiento[item.cliente_id] = item.created_at;
      }
    });

    clientes.forEach((cliente) => {
      const citasCliente = citasPorCliente[cliente.id] || [];
      const tieneCitaFutura = citasCliente.some((cita) => (horasHasta(cita.fecha_hora, ahora) || -1) >= 0);
      if (tieneCitaFutura) return;
      const ultimaActividad = [cliente.updated_at, cliente.created_at, ultimoSeguimiento[cliente.id]]
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0];
      const horas = horasDesde(ultimaActividad, ahora);
      const etapa = String(cliente.etapa_interes || "").toLowerCase();
      let nivel = null;
      let motivo = "";
      if (etapa === "caliente" && horas >= 72) {
        nivel = "P0";
        motivo = `Cliente caliente sin actividad desde hace ${Math.floor(horas / 24)} días`;
      } else if (etapa === "caliente" && horas >= 24) {
        nivel = "P1";
        motivo = `Cliente caliente sin actividad desde hace ${Math.floor(horas)} horas`;
      } else if (etapa === "nuevo" && horas >= 48) {
        nivel = "P0";
        motivo = "Cliente nuevo sin cita ni seguimiento en 48 horas";
      } else if (etapa === "en_seguimiento" && horas >= 168) {
        nivel = "P1";
        motivo = `Sin actividad desde hace ${Math.floor(horas / 24)} días`;
      }
      if (!nivel) return;
      candidatos.push(crearPendiente({
        id: `cliente-${cliente.id}`,
        nivel,
        titulo: `Seguimiento pendiente: ${cliente.nombre || "cliente"}`,
        motivo,
        responsable: nombreRelacionado(cliente.profiles, nombrePerfil(auth.perfil)),
        modulo: "Clientes",
        href: "/clientes",
        fechaReferencia: ultimaActividad,
        puntos: nivel === "P0" ? 30 : 10,
      }));
    });
  }

  if (dominios.includes("juridico")) {
    const [solicitudes, polizas, firmas, citasFirma] = await Promise.all([
      safe("Solicitudes de póliza", supabase
        .from("solicitudes_inquilino")
        .select("id, nombre_completo, razon_social, status, created_at, ia_revision_manual, ia_analisis_documental")),
      safe("Pólizas", supabase
        .from("poliza_expedientes")
        .select("id, nombre_arrendatario, direccion_inmueble, fecha_vigencia, status, expediente_anterior_id, monto_poliza, anticipo_poliza, saldo_pagado, created_at, updated_at")),
      safe("Firmas", supabase
        .from("firmas")
        .select("id, titulo, nombre_comprador, status, etapa_actual, created_at, updated_at, firma_etapas(status, responsable, nombre)")),
      safe("Citas de firma", supabase
        .from("firmas_citas")
        .select("id, firma_id, titulo, fecha, hora")),
    ]);

    solicitudes.forEach((solicitud) => {
      if (!solicitudSigueAbierta(solicitud.status)) return;
      if (firmas.some((firma) => firmaCierraSolicitud(firma, solicitud))) return;
      const analisis = solicitud.ia_analisis_documental || {};
      const fallos = Array.isArray(analisis.documentos_fallidos) ? analisis.documentos_fallidos : [];
      const pendienteHoras = solicitud.status === "pendiente" ? horasDesde(solicitud.created_at, ahora) : 0;
      if (!solicitud.ia_revision_manual && !fallos.length && pendienteHoras < 24) return;
      const nivel = solicitud.ia_revision_manual || fallos.length || pendienteHoras >= 48 ? "P0" : "P1";
      const motivos = [];
      if (solicitud.ia_revision_manual) motivos.push("marcado para revisión manual");
      if (fallos.length) motivos.push(`${fallos.length} documento${fallos.length === 1 ? "" : "s"} con fallo`);
      if (pendienteHoras >= 24) motivos.push(`${Math.floor(pendienteHoras)} h pendiente`);
      candidatos.push(crearPendiente({
        id: `solicitud-${solicitud.id}`,
        nivel,
        titulo: `Revisar expediente: ${solicitud.nombre_completo || solicitud.razon_social || "solicitante"}`,
        motivo: motivos.join(" · "),
        responsable: "Jurídico",
        modulo: "Pólizas",
        href: `/poliza/solicitud/${solicitud.id}`,
        fechaReferencia: solicitud.created_at,
        puntos: (solicitud.ia_revision_manual ? 30 : 0) + (fallos.length ? 20 : 0),
      }));
    });

    const renovadas = new Set(polizas.map((poliza) => poliza.expediente_anterior_id).filter(Boolean));
    polizas.forEach((poliza) => {
      const dias = diasEntreFechas(hoy, poliza.fecha_vigencia);
      if (poliza.status === "activo" && dias !== null && dias <= 30 && !renovadas.has(poliza.id)) {
        const nivel = dias <= 15 ? "P0" : "P1";
        candidatos.push(crearPendiente({
          id: `poliza-vigencia-${poliza.id}`,
          nivel,
          titulo: `Vigencia de póliza: ${poliza.nombre_arrendatario || poliza.direccion_inmueble || "expediente"}`,
          motivo: dias < 0 ? `Póliza activa vencida hace ${Math.abs(dias)} días` : `Vence en ${dias} días`,
          responsable: "Jurídico",
          modulo: "Pólizas",
          href: "/poliza",
          fechaReferencia: poliza.fecha_vigencia,
          puntos: 20 + (dias <= 0 ? 30 : 0),
        }));
      }
      const saldoPendiente = Math.max(0, (Number(poliza.monto_poliza) || 0) - (Number(poliza.anticipo_poliza) || 0));
      if (saldoPendiente > 0 && !poliza.saldo_pagado) {
        candidatos.push(crearPendiente({
          id: `poliza-saldo-${poliza.id}`,
          nivel: "P1",
          titulo: `Saldo de póliza: ${poliza.nombre_arrendatario || poliza.direccion_inmueble || "expediente"}`,
          motivo: `Saldo registrado por ${saldoPendiente.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}`,
          responsable: "Jurídico",
          modulo: "Pólizas",
          href: "/poliza",
          fechaReferencia: poliza.updated_at || poliza.created_at,
          monto: saldoPendiente,
          puntos: saldoPendiente >= 15000 ? 30 : 10,
        }));
      }
    });

    const citasPorFirma = {};
    citasFirma.forEach((cita) => {
      if (!citasPorFirma[cita.firma_id]) citasPorFirma[cita.firma_id] = [];
      citasPorFirma[cita.firma_id].push(cita);
    });
    firmas.filter((firma) => firma.status === "activo").forEach((firma) => {
      const etapa = (firma.firma_etapas || []).find((item) => ["pendiente", "en_proceso"].includes(item.status));
      if (auth.perfil.role_id === "juridico" && etapa?.responsable && etapa.responsable !== "juridico") return;
      const horas = horasDesde(firma.updated_at || firma.created_at, ahora);
      const citaVencida = (citasPorFirma[firma.id] || []).find((cita) => {
        const fechaHora = `${cita.fecha}T${cita.hora || "23:59:00"}`;
        const hasta = horasHasta(fechaHora, ahora);
        return hasta !== null && hasta < 0;
      });
      if (horas < 24 && !citaVencida) return;
      const nivel = horas >= 48 || citaVencida ? "P0" : "P1";
      candidatos.push(crearPendiente({
        id: `firma-${firma.id}`,
        nivel,
        titulo: firma.titulo || "Firma pendiente",
        motivo: citaVencida ? "Cita de firma vencida sin cierre" : `${Math.floor(horas)} horas sin movimiento`,
        responsable: etapa?.nombre || "Jurídico",
        modulo: "Firmas",
        href: `/firmas/${firma.id}`,
        fechaReferencia: firma.updated_at || firma.created_at,
        puntos: citaVencida ? 30 : horas >= 72 ? 20 : 10,
      }));
    });
  }

  const pendientes = ordenarPrioridades(candidatos, 5);
  const resumen = pendientes.length
    ? await resumenClaude(pendientes)
    : "Todo en orden por ahora";
  const data = {
    pendientes,
    resumen,
    generadoEn: new Date().toISOString(),
    desdeCache: false,
    puedeForzar: esAdmin,
    fuentesConError,
  };

  cache.set(cacheKey, {
    data,
    expira: Date.now() + (esAdmin ? CACHE_TTL : CACHE_TTL_OTROS_ROLES),
  });
  return res.status(200).json(data);
}
