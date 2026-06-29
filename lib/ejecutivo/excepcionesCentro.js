import { roundMoney, toNumber } from './lecturaBiCierresAdmin';

const DIA = 24 * 60 * 60 * 1000;
const PRIORIDAD_SCORE = { P0: 300, P1: 200, P2: 100 };

const fmtMoney = (value) => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const normalizar = (valor) => String(valor || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const fechaValida = (valor) => {
  if (!valor) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

const fechaDia = (valor) => String(valor || '').slice(0, 10);

const hoyMexico = (ahora = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(ahora);

const diasEntre = (desde, hasta) => {
  if (!desde || !hasta) return null;
  const inicio = new Date(`${fechaDia(desde)}T12:00:00`);
  const fin = new Date(`${fechaDia(hasta)}T12:00:00`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;
  return Math.round((fin.getTime() - inicio.getTime()) / DIA);
};

const horasDesde = (valor, ahora = new Date()) => {
  const fecha = fechaValida(valor);
  if (!fecha) return 0;
  return Math.max(0, (ahora.getTime() - fecha.getTime()) / (60 * 60 * 1000));
};

const fechaMasReciente = (...values) => values
  .flat()
  .filter(Boolean)
  .map((value) => ({ raw: value, date: fechaValida(value) }))
  .filter((item) => item.date)
  .sort((a, b) => b.date - a.date)[0]?.raw || null;

const contarPor = (items = [], key = 'propiedad_id') => {
  const map = new Map();
  items.forEach((item) => {
    const id = item?.[key];
    if (!id) return;
    const current = map.get(String(id)) || { total: 0, fechas: [] };
    current.total += 1;
    const fecha = item.created_at || item.fecha_hora || item.fecha || item.envios?.created_at;
    if (fecha) current.fechas.push(fecha);
    map.set(String(id), current);
  });
  return map;
};

const crearExcepcion = ({
  id,
  prioridad = 'P2',
  area,
  categoria,
  titulo,
  motivo,
  impacto,
  recomendacion,
  responsable = 'Por asignar',
  modulo,
  href,
  fecha_referencia = null,
  monto = 0,
  score = 0,
  origen_regla = 'sistema',
  familia_regla = 'regla_automatica',
  metadata = {},
}) => ({
  id: String(id),
  prioridad,
  nivel: prioridad,
  area,
  categoria,
  titulo,
  motivo,
  impacto,
  recomendacion,
  responsable,
  modulo,
  href,
  fecha_referencia,
  monto: roundMoney(monto),
  score: (PRIORIDAD_SCORE[prioridad] || 0) + Number(score || 0) + Math.min(50, Math.floor(toNumber(monto) / 1000)),
  origen_regla,
  familia_regla,
  metadata,
});

const ordenar = (items = [], limite = 10) => {
  const vistos = new Set();
  return items
    .filter(Boolean)
    .filter((item) => ['P0', 'P1', 'P2'].includes(item.prioridad))
    .filter((item) => {
      if (vistos.has(item.id)) return false;
      vistos.add(item.id);
      return true;
    })
    .sort((a, b) => {
      if (a.prioridad !== b.prioridad) return (PRIORIDAD_SCORE[b.prioridad] || 0) - (PRIORIDAD_SCORE[a.prioridad] || 0);
      if (a.score !== b.score) return b.score - a.score;
      if (a.monto !== b.monto) return b.monto - a.monto;
      return new Date(a.fecha_referencia || 0) - new Date(b.fecha_referencia || 0);
    })
    .slice(0, limite);
};

const resumenConteo = (items = []) => ({
  total: items.length,
  p0: items.filter((item) => item.prioridad === 'P0').length,
  p1: items.filter((item) => item.prioridad === 'P1').length,
  p2: items.filter((item) => item.prioridad === 'P2').length,
});

const solicitudAbierta = (status) => {
  const value = normalizar(status);
  return !value || ['pendiente', 'en_revision', 'revision', 'revision_manual'].includes(value);
};

const firmaCierraSolicitud = (firma, solicitud) => {
  const solicitante = normalizar(solicitud?.nombre_completo || solicitud?.razon_social);
  const comprador = normalizar(firma?.nombre_comprador || firma?.titulo);
  if (!solicitante || !comprador) return false;
  const coincide = solicitante === comprador || solicitante.includes(comprador) || comprador.includes(solicitante);
  if (!coincide) return false;
  return normalizar(firma.status) === 'completado' || toNumber(firma.etapa_actual) >= 12;
};

function construirAtencionAdministracion({ pagos = [], contratos = [], mantenimientos = [], ahora, hoy }) {
  const items = [];

  pagos.forEach((pago) => {
    const dias = diasEntre(pago.due_date, hoy);
    const monto = toNumber(pago.amount);
    if (pago.status === 'atrasado' && dias > 0) {
      const prioridad = dias >= 10 || monto >= 15000 ? 'P0' : 'P1';
      items.push(crearExcepcion({
        id: `cobranza-${pago.id}`,
        prioridad,
        area: 'Cobranza',
        categoria: 'renta_vencida',
        titulo: `Cobranza vencida: ${pago.tenant_name || pago.property_name || 'renta pendiente'}`,
        motivo: `${dias} día${dias === 1 ? '' : 's'} de atraso · ${fmtMoney(monto)}`,
        impacto: 'Puede afectar flujo de caja y relación con propietario si no se gestiona hoy.',
        recomendacion: 'Contactar al inquilino y registrar actualización de cobro.',
        responsable: 'Administración',
        modulo: 'Cobranza',
        href: '/cobranza',
        fecha_referencia: pago.due_date,
        monto,
        score: dias >= 10 ? 30 : 10,
      }));
    }
  });

  contratos.forEach((contrato) => {
    const dias = diasEntre(hoy, contrato.end_date);
    if (dias === null || dias > 30) return;
    const prioridad = dias <= 15 ? 'P0' : 'P1';
    items.push(crearExcepcion({
      id: `renovacion-${contrato.id}`,
      prioridad,
      area: 'Administración',
      categoria: 'renovacion_proxima',
      titulo: `Renovación: ${contrato.property_name || contrato.tenant_name || 'contrato'}`,
      motivo: dias < 0 ? `Contrato activo vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}` : `Vence en ${dias} día${dias === 1 ? '' : 's'}`,
      impacto: 'Puede quedarse vencido y generar incertidumbre administrativa.',
      recomendacion: 'Confirmar renovación, salida o nuevo contrato.',
      responsable: 'Administración',
      modulo: 'Renovaciones',
      href: '/contratos',
      fecha_referencia: contrato.end_date,
      score: dias <= 0 ? 40 : 20,
    }));
  });

  mantenimientos.forEach((ticket) => {
    const horas = horasDesde(ticket.updated_at || ticket.created_at, ahora);
    const prioridadTicket = normalizar(ticket.priority);
    const status = normalizar(ticket.status);
    if (['cerrado', 'cancelado', 'resuelto'].includes(status)) return;
    const esUrgente = prioridadTicket === 'urgente' || horas >= 72;
    const esAlta = prioridadTicket === 'alta' || horas >= 24;
    if (!esUrgente && !esAlta) return;
    items.push(crearExcepcion({
      id: `mantenimiento-${ticket.id}`,
      prioridad: esUrgente ? 'P0' : 'P1',
      area: 'Mantenimiento',
      categoria: 'mantenimiento_detenido',
      titulo: ticket.title || `Mantenimiento: ${ticket.property_name || 'propiedad'}`,
      motivo: prioridadTicket === 'urgente'
        ? `Ticket urgente${horas ? ` · ${Math.floor(horas)} h sin movimiento` : ''}`
        : `${Math.floor(horas)} horas sin movimiento`,
      impacto: 'Puede escalar a queja, daño mayor o inconformidad del propietario/inquilino.',
      recomendacion: 'Asignar siguiente acción y registrar avance hoy.',
      responsable: 'Administración',
      modulo: 'Mantenimiento',
      href: '/mantenimiento',
      fecha_referencia: ticket.updated_at || ticket.created_at,
      score: esUrgente ? 35 : 15,
    }));
  });

  return items;
}

function construirAtencionComercial({ citas = [], clientes = [], seguimientos = [], ahora }) {
  const items = [];
  const seguimientosPorCliente = new Map();
  seguimientos.forEach((seguimiento) => {
    const id = seguimiento.cliente_id;
    if (!id) return;
    const current = seguimientosPorCliente.get(String(id));
    if (!current || new Date(seguimiento.created_at) > new Date(current)) {
      seguimientosPorCliente.set(String(id), seguimiento.created_at);
    }
  });

  const citasPorCliente = new Map();
  citas.forEach((cita) => {
    if (cita.cliente_id) {
      const current = citasPorCliente.get(String(cita.cliente_id)) || [];
      current.push(cita);
      citasPorCliente.set(String(cita.cliente_id), current);
    }
    if (cita.estado !== 'agendada') return;
    const fecha = fechaValida(cita.fecha_hora);
    if (!fecha) return;
    const horas = (fecha.getTime() - ahora.getTime()) / (60 * 60 * 1000);
    const cliente = cita.clientes?.nombre || 'cliente';
    const responsable = cita.profiles?.full_name || cita.profiles?.email || 'Asesor';
    if (horas < 0) {
      items.push(crearExcepcion({
        id: `cita-vencida-${cita.id}`,
        prioridad: 'P0',
        area: 'Comercial',
        categoria: 'cita_vencida',
        titulo: `Cita vencida: ${cliente}`,
        motivo: `Sigue agendada ${Math.max(1, Math.floor(Math.abs(horas)))} h después de su hora.`,
        impacto: 'Si no se actualiza, se pierde lectura comercial y seguimiento real.',
        recomendacion: 'Actualizar resultado de la cita y siguiente paso del cliente.',
        responsable,
        modulo: 'Clientes',
        href: cita.cliente_id ? `/clientes/${cita.cliente_id}` : '/clientes',
        fecha_referencia: cita.fecha_hora,
        score: 35,
      }));
    } else if (horas <= 24) {
      items.push(crearExcepcion({
        id: `cita-hoy-${cita.id}`,
        prioridad: 'P1',
        area: 'Comercial',
        categoria: 'cita_proxima',
        titulo: `Cita próxima: ${cliente}`,
        motivo: `Agendada dentro de las próximas ${Math.max(1, Math.ceil(horas))} horas.`,
        impacto: 'Conviene asegurar confirmación y preparación para no perder oportunidad.',
        recomendacion: 'Confirmar cita y revisar propiedad/interés antes de atender.',
        responsable,
        modulo: 'Clientes',
        href: cita.cliente_id ? `/clientes/${cita.cliente_id}` : '/clientes',
        fecha_referencia: cita.fecha_hora,
        score: 10,
      }));
    }
  });

  clientes.forEach((cliente) => {
    const etapa = normalizar(cliente.etapa_interes);
    if (['perdido', 'cerrado'].includes(etapa)) return;
    const citasCliente = citasPorCliente.get(String(cliente.id)) || [];
    const tieneCitaFutura = citasCliente.some((cita) => cita.estado === 'agendada' && fechaValida(cita.fecha_hora) >= ahora);
    if (tieneCitaFutura) return;
    const ultimaActividad = fechaMasReciente(cliente.updated_at, cliente.created_at, seguimientosPorCliente.get(String(cliente.id)));
    const horas = horasDesde(ultimaActividad, ahora);
    const responsable = cliente.profiles?.full_name || cliente.profiles?.email || 'Asesor';
    let prioridad = null;
    let motivo = '';
    if (etapa === 'caliente' && horas >= 72) {
      prioridad = 'P0';
      motivo = `Cliente caliente sin actividad desde hace ${Math.floor(horas / 24)} días.`;
    } else if (etapa === 'caliente' && horas >= 24) {
      prioridad = 'P1';
      motivo = `Cliente caliente sin actividad desde hace ${Math.floor(horas)} horas.`;
    } else if (etapa === 'nuevo' && horas >= 48) {
      prioridad = 'P1';
      motivo = 'Cliente nuevo sin cita ni seguimiento en 48 horas.';
    }
    if (!prioridad) return;
    items.push(crearExcepcion({
      id: `cliente-${cliente.id}`,
      prioridad,
      area: 'Clientes',
      categoria: 'cliente_sin_seguimiento',
      titulo: `Seguimiento pendiente: ${cliente.nombre || 'cliente'}`,
      motivo,
      impacto: 'Puede enfriarse o irse con otra inmobiliaria.',
      recomendacion: 'Recontactar y definir siguiente acción concreta.',
      responsable,
      modulo: 'Clientes',
      href: `/clientes/${cliente.id}`,
      fecha_referencia: ultimaActividad,
      score: prioridad === 'P0' ? 30 : 10,
    }));
  });

  return items;
}

function construirPropiedadesAtencion({ propiedades = [], visitas = [], contactos = [], envios = [], citas = [], recibos = [], ahora, hoy }) {
  const items = [];
  const visitasPorProp = contarPor(visitas);
  const contactosPorProp = contarPor(contactos);
  const enviosPorProp = contarPor(envios);
  const citasPorProp = contarPor(citas);
  const recibosPorProp = contarPor(recibos, 'propiedad_id');

  propiedades.forEach((propiedad) => {
    const id = String(propiedad.id);
    const status = propiedad.status;
    const fotos = Array.isArray(propiedad.fotos) ? propiedad.fotos : [];
    const v = visitasPorProp.get(id) || { total: 0, fechas: [] };
    const c = contactosPorProp.get(id) || { total: 0, fechas: [] };
    const e = enviosPorProp.get(id) || { total: 0, fechas: [] };
    const ci = citasPorProp.get(id) || { total: 0, fechas: [] };
    const actividadTotal = v.total + c.total + e.total + ci.total;
    const ultimaActividad = fechaMasReciente(v.fechas, c.fechas, e.fechas, ci.fechas, propiedad.updated_at, propiedad.created_at);
    const diasSinActividad = ultimaActividad ? Math.floor(horasDesde(ultimaActividad, ahora) / 24) : null;

    if (status === 'published' && diasSinActividad !== null && diasSinActividad >= 14) {
      items.push(crearExcepcion({
        id: `propiedad-sin-actividad-${id}`,
        prioridad: diasSinActividad >= 30 ? 'P1' : 'P2',
        area: 'Propiedades',
        categoria: 'sin_actividad_reciente',
        titulo: propiedad.titulo || 'Propiedad publicada',
        motivo: `${diasSinActividad} días sin actividad comercial reciente.`,
        impacto: 'La publicación puede estar perdiendo visibilidad o interés.',
        recomendacion: 'Revisar portada, precio, texto y relanzar campaña si aplica.',
        responsable: 'Comercial',
        modulo: 'Propiedades',
        href: `/propiedades-admin?propiedad=${propiedad.id}`,
        fecha_referencia: ultimaActividad,
        score: Math.min(40, diasSinActividad),
        metadata: { visitas: v.total, contactos: c.total, envios: e.total, citas: ci.total, status },
      }));
    }

    if (status === 'published' && actividadTotal >= 10 && ci.total === 0) {
      items.push(crearExcepcion({
        id: `propiedad-baja-conversion-${id}`,
        prioridad: 'P1',
        area: 'Propiedades',
        categoria: 'baja_conversion',
        titulo: propiedad.titulo || 'Propiedad publicada',
        motivo: `${actividadTotal} acciones este mes sin citas registradas.`,
        impacto: 'Hay interés inicial, pero no se está convirtiendo en avance comercial.',
        recomendacion: c.total > 0 ? 'Recontactar interesados y ajustar llamada a la acción.' : 'Revisar precio, portada y calidad de anuncio.',
        responsable: 'Comercial',
        modulo: 'Propiedades',
        href: `/propiedades-admin?propiedad=${propiedad.id}`,
        fecha_referencia: ultimaActividad,
        score: actividadTotal,
        metadata: { visitas: v.total, contactos: c.total, envios: e.total, citas: ci.total, status },
      }));
    }

    if (status === 'published' && ci.total >= 2 && !recibosPorProp.get(id)) {
      items.push(crearExcepcion({
        id: `propiedad-actividad-sin-avance-${id}`,
        prioridad: 'P1',
        area: 'Propiedades',
        categoria: 'actividad_sin_avance',
        titulo: propiedad.titulo || 'Propiedad publicada',
        motivo: `${ci.total} citas registradas y sigue publicada sin apartado.`,
        impacto: 'Puede haber objeción de precio, producto o seguimiento que está frenando el cierre.',
        recomendacion: 'Revisar feedback de citas y decidir si ajustar precio, fotos o seguimiento.',
        responsable: 'Comercial',
        modulo: 'Propiedades',
        href: `/propiedades-admin?propiedad=${propiedad.id}`,
        fecha_referencia: ultimaActividad,
        score: 20 + ci.total,
        metadata: { visitas: v.total, contactos: c.total, envios: e.total, citas: ci.total, status },
      }));
    }

    if (status === 'published' && fotos.length > 0 && fotos.length < 5 && actividadTotal >= 5) {
      items.push(crearExcepcion({
        id: `propiedad-fotos-insuficientes-${id}`,
        prioridad: 'P2',
        area: 'Propiedades',
        categoria: 'fotos_insuficientes',
        titulo: propiedad.titulo || 'Propiedad publicada',
        motivo: `Tiene ${fotos.length} foto${fotos.length === 1 ? '' : 's'} y ya registra actividad.`,
        impacto: 'La falta de material visual puede bajar conversión.',
        recomendacion: 'Solicitar nuevas fotografías o reorganizar portada.',
        responsable: 'Comercial',
        modulo: 'Propiedades',
        href: `/propiedades-admin?propiedad=${propiedad.id}`,
        fecha_referencia: ultimaActividad,
        score: actividadTotal,
        metadata: { visitas: v.total, contactos: c.total, envios: e.total, citas: ci.total, status, fotos: fotos.length },
      }));
    }

    if (status === 'reserved') {
      const dias = diasEntre(hoy, propiedad.apartado_vigencia_hasta);
      if (dias !== null && dias <= 2) {
        items.push(crearExcepcion({
          id: `propiedad-reserva-vigencia-${id}`,
          prioridad: dias < 0 ? 'P0' : 'P1',
          area: 'Operaciones',
          categoria: 'apartado_por_vencer',
          titulo: propiedad.titulo || 'Propiedad reservada',
          motivo: dias < 0 ? `Apartado vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}.` : `Apartado vence en ${dias} día${dias === 1 ? '' : 's'}.`,
          impacto: 'La propiedad está fuera de disponibilidad y requiere decisión manual.',
          recomendacion: 'Confirmar si avanza, se extiende o se cancela el apartado.',
          responsable: 'Comercial',
          modulo: 'Propiedades',
          href: `/propiedades-admin?propiedad=${propiedad.id}`,
          fecha_referencia: propiedad.apartado_vigencia_hasta,
          monto: propiedad.apartado_monto,
          score: dias < 0 ? 40 : 20,
          metadata: { status, apartado_vigencia_hasta: propiedad.apartado_vigencia_hasta },
        }));
      }
    }
  });

  return ordenar(items, 8);
}

function construirOperacionesAtencion({ recibos = [], firmas = [], citasFirma = [], cierres = [], ahora, hoy }) {
  const items = [];
  const firmasPorRecibo = new Map(firmas.filter((firma) => firma.recibo_id).map((firma) => [String(firma.recibo_id), firma]));
  const cierresPorRecibo = new Map(cierres.filter((cierre) => cierre.recibo_id).map((cierre) => [String(cierre.recibo_id), cierre]));
  const citasPorFirma = new Map();
  citasFirma.forEach((cita) => {
    if (!cita.firma_id) return;
    const arr = citasPorFirma.get(String(cita.firma_id)) || [];
    arr.push(cita);
    citasPorFirma.set(String(cita.firma_id), arr);
  });

  recibos.forEach((recibo) => {
    const status = normalizar(recibo.estatus);
    if (status === 'cancelado') return;
    const firma = recibo.firma_id ? firmasPorRecibo.get(String(recibo.id)) || firmas.find((f) => f.id === recibo.firma_id) : firmasPorRecibo.get(String(recibo.id));
    if (status === 'activo' && !firma) {
      const horas = horasDesde(recibo.created_at, ahora);
      if (horas >= 24) {
        items.push(crearExcepcion({
          id: `recibo-sin-firma-${recibo.id}`,
          prioridad: horas >= 48 ? 'P0' : 'P1',
          area: 'Operaciones',
          categoria: 'recibo_sin_firma',
          titulo: `Recibo activo sin flujo: ${recibo.folio || recibo.cliente_nombre || 'apartado'}`,
          motivo: `${Math.floor(horas)} h desde el apartado sin expediente de firmas.`,
          impacto: 'Puede retrasar póliza, firma o promesa y dejar operación sin seguimiento.',
          recomendacion: 'Iniciar flujo de firmas o documentar motivo de espera.',
          responsable: 'Dirección / Jurídico',
          modulo: 'Recibos',
          href: '/recibos',
          fecha_referencia: recibo.created_at,
          monto: recibo.monto_total_acordado || recibo.monto,
          score: horas >= 48 ? 35 : 15,
        }));
      }
    }

    const total = toNumber(recibo.monto_total_acordado || recibo.monto);
    const recibido = toNumber(recibo.monto) + (recibo.recibos_abonos || []).reduce((sum, abono) => sum + toNumber(abono.monto), 0);
    const saldo = Math.max(0, total - recibido);
    if (saldo > 0 && status !== 'cancelado') {
      items.push(crearExcepcion({
        id: `recibo-saldo-${recibo.id}`,
        prioridad: saldo >= 5000 ? 'P1' : 'P2',
        area: 'Dinero',
        categoria: 'abono_pendiente',
        titulo: `Saldo de apartado: ${recibo.folio || recibo.cliente_nombre || 'recibo'}`,
        motivo: `Faltan ${fmtMoney(saldo)} de ${fmtMoney(total)} pactados.`,
        impacto: 'El cierre financiero puede quedar incompleto si no se registra el complemento.',
        recomendacion: 'Solicitar/comprobar abono complementario y sincronizar a cierres.',
        responsable: 'Dirección',
        modulo: 'Recibos',
        href: '/recibos',
        fecha_referencia: recibo.updated_at || recibo.created_at,
        monto: saldo,
        score: 10,
      }));
    }
  });

  firmas.filter((firma) => normalizar(firma.status) === 'activo').forEach((firma) => {
    const horas = horasDesde(firma.updated_at || firma.created_at, ahora);
    const etapas = firma.firma_etapas || [];
    const etapa = etapas.find((item) => ['pendiente', 'en_proceso'].includes(normalizar(item.status)));
    const citas = citasPorFirma.get(String(firma.id)) || [];
    const citaVencida = citas.find((cita) => diasEntre(`${cita.fecha}T${cita.hora || '23:59:00'}`, hoy) < 0);

    if (citaVencida || horas >= 48) {
      items.push(crearExcepcion({
        id: `firma-detenida-${firma.id}`,
        prioridad: citaVencida || horas >= 72 ? 'P0' : 'P1',
        area: 'Jurídico',
        categoria: 'firma_detenida',
        titulo: firma.titulo || 'Firma en proceso',
        motivo: citaVencida ? 'Tiene cita de firma vencida sin cierre.' : `${Math.floor(horas)} h sin movimiento.`,
        impacto: 'Puede detener la operación y retrasar ingreso/cierre.',
        recomendacion: 'Confirmar siguiente responsable y actualizar etapa hoy.',
        responsable: etapa?.nombre || etapa?.responsable || 'Jurídico',
        modulo: 'Firmas',
        href: `/firmas/${firma.id}`,
        fecha_referencia: firma.updated_at || firma.created_at,
        score: citaVencida ? 40 : 20,
      }));
    }

    const avance = toNumber(firma.etapa_actual);
    const tieneCierre = firma.recibo_id && cierresPorRecibo.has(String(firma.recibo_id));
    if (avance >= 10 && firma.recibo_id && !tieneCierre) {
      items.push(crearExcepcion({
        id: `firma-sin-cierre-${firma.id}`,
        prioridad: 'P1',
        area: 'Cierres',
        categoria: 'firma_avanzada_sin_cierre',
        titulo: firma.titulo || 'Firma avanzada sin cierre',
        motivo: `Firma en etapa ${avance}, pero sin cierre financiero vinculado.`,
        impacto: 'Puede haber operación avanzada sin control financiero definitivo.',
        recomendacion: 'Revisar si Carlos/Admin debe registrar cierre financiero.',
        responsable: 'Dirección',
        modulo: 'Cierres',
        href: '/cierres',
        fecha_referencia: firma.updated_at || firma.created_at,
        score: 25,
      }));
    }
  });

  return ordenar(items, 10);
}

function construirPolizaAtencion({ solicitudes = [], firmas = [], ahora }) {
  const items = [];
  solicitudes.forEach((solicitud) => {
    if (!solicitudAbierta(solicitud.status)) return;
    if (firmas.some((firma) => firmaCierraSolicitud(firma, solicitud))) return;
    const analisis = solicitud.ia_analisis_documental || {};
    const fallos = Array.isArray(analisis.documentos_fallidos) ? analisis.documentos_fallidos : [];
    const horas = horasDesde(solicitud.updated_at || solicitud.created_at, ahora);
    if (!solicitud.ia_revision_manual && !fallos.length && horas < 48) return;
    items.push(crearExcepcion({
      id: `poliza-revision-${solicitud.id}`,
      prioridad: solicitud.ia_revision_manual || fallos.length || horas >= 72 ? 'P0' : 'P1',
      area: 'Jurídico',
      categoria: 'poliza_revision_manual',
      titulo: `Revisar expediente: ${solicitud.nombre_completo || solicitud.razon_social || 'solicitante'}`,
      motivo: [
        solicitud.ia_revision_manual ? 'marcado para revisión manual' : null,
        fallos.length ? `${fallos.length} documento${fallos.length === 1 ? '' : 's'} con fallo` : null,
        horas >= 48 ? `${Math.floor(horas)} h sin resolver` : null,
      ].filter(Boolean).join(' · '),
      impacto: 'Puede detener investigación, firma o avance del arrendamiento.',
      recomendacion: 'Revisar documentos faltantes/fallidos y solicitar corrección si aplica.',
      responsable: 'Jurídico',
      modulo: 'Pólizas',
      href: `/poliza/solicitud/${solicitud.id}`,
      fecha_referencia: solicitud.updated_at || solicitud.created_at,
      score: fallos.length * 10 + (solicitud.ia_revision_manual ? 25 : 0),
    }));
  });
  return items;
}

function construirPartnersAtencion({ partners = [], ahora }) {
  const items = [];
  partners.forEach((op) => {
    const status = normalizar(op.status_partner);
    if (['activa', 'aprobada', 'rechazada', 'cancelada'].includes(status)) return;
    const horas = horasDesde(op.updated_at || op.created_at, ahora);
    if (horas < 48) return;
    items.push(crearExcepcion({
      id: `partner-${op.id}`,
      prioridad: horas >= 96 ? 'P1' : 'P2',
      area: 'Partners',
      categoria: 'partner_sin_respuesta',
      titulo: `Partner esperando respuesta: ${op.folio || op.nombre_inquilino || op.direccion_inmueble || 'operación'}`,
      motivo: `${Math.floor(horas / 24)} días en estado ${op.status_partner || 'recibida'}.`,
      impacto: 'Puede afectar relación con broker externo y perder oportunidad de póliza.',
      recomendacion: 'Responder estatus o pedir documentos faltantes.',
      responsable: 'Jurídico / Dirección',
      modulo: 'Partners',
      href: '/poliza/partners',
      fecha_referencia: op.updated_at || op.created_at,
      monto: op.commission_estimated,
      score: horas >= 96 ? 15 : 5,
    }));
  });
  return items;
}

function construirDineroAtencion({ cierres = [], cierrePagos = [], resumenCentro = {} }) {
  const items = [];
  const pagosPorCierre = new Map();
  cierrePagos.forEach((pago) => {
    const arr = pagosPorCierre.get(String(pago.cierre_id)) || [];
    arr.push(pago);
    pagosPorCierre.set(String(pago.cierre_id), arr);
  });

  cierres.forEach((cierre) => {
    const pendiente = toNumber(cierre.pendiente);
    const pagos = pagosPorCierre.get(String(cierre.id)) || [];
    const totalPagos = pagos.reduce((sum, pago) => sum + toNumber(pago.monto), 0);
    if (pendiente > 0) {
      items.push(crearExcepcion({
        id: `cierre-pendiente-${cierre.id}`,
        prioridad: pendiente >= 10000 ? 'P1' : 'P2',
        area: 'Dinero',
        categoria: 'cierre_pendiente_cobro',
        titulo: `Cierre con saldo: ${cierre.propiedad || cierre.operacion || 'operación'}`,
        motivo: `Pendiente de cobrar ${fmtMoney(pendiente)}.`,
        impacto: 'Ingreso generado todavía no se ha convertido en caja.',
        recomendacion: 'Confirmar fecha de liquidación o registrar pago.',
        responsable: 'Dirección',
        modulo: 'Cierres',
        href: '/cierres',
        fecha_referencia: cierre.fecha_cierre,
        monto: pendiente,
        score: 15,
      }));
    }
    if (toNumber(cierre.cobrado) > 0 && pagos.length === 0) {
      items.push(crearExcepcion({
        id: `cierre-sin-desglose-${cierre.id}`,
        prioridad: 'P2',
        area: 'Dinero',
        categoria: 'cierre_sin_desglose',
        titulo: `Cierre sin pagos detallados: ${cierre.propiedad || cierre.operacion || 'operación'}`,
        motivo: `Tiene ${fmtMoney(cierre.cobrado)} cobrado, pero sin desglose en pagos.`,
        impacto: 'Reduce confiabilidad de conciliación y lectura de caja.',
        recomendacion: 'Registrar pagos o regularizar evidencia.',
        responsable: 'Dirección',
        modulo: 'Cierres',
        href: '/cierres',
        fecha_referencia: cierre.fecha_cierre,
        monto: toNumber(cierre.cobrado) - totalPagos,
        score: 5,
      }));
    }
  });

  (resumenCentro.acciones_pendientes || []).forEach((accion) => {
    if (!accion.inconsistencias_activas && !accion.revision_manual && !accion.sin_evidencia) return;
    items.push(crearExcepcion({
      id: `conciliacion-${accion.key}`,
      prioridad: accion.sin_evidencia > 0 || accion.revision_manual > 0 ? 'P1' : 'P2',
      area: 'Dinero',
      categoria: 'conciliacion_pendiente',
      titulo: `Conciliación pendiente: ${accion.label}`,
      motivo: accion.nota || `${accion.inconsistencias_activas || 0} inconsistencias activas.`,
      impacto: 'Puede distorsionar lectura financiera si se toman decisiones sin conciliar.',
      recomendacion: 'Abrir conciliación correspondiente y regularizar lo evidente.',
      responsable: 'Dirección',
      modulo: 'Ejecutivo',
      href: '/ejecutivo/inteligencia',
      score: Number(accion.inconsistencias_activas || 0) * 5,
    }));
  });

  return ordenar(items, 8);
}

export function construirCentroExcepciones({
  ahora = new Date(),
  datos = {},
  resumenCentro = {},
}) {
  const hoy = hoyMexico(ahora);
  const administracion = construirAtencionAdministracion({
    pagos: datos.pagos,
    contratos: datos.contratos,
    mantenimientos: datos.mantenimientos,
    ahora,
    hoy,
  });
  const comercial = construirAtencionComercial({
    citas: datos.citas,
    clientes: datos.clientes,
    seguimientos: datos.seguimientos,
    ahora,
  });
  const propiedades = construirPropiedadesAtencion({
    propiedades: datos.propiedades,
    visitas: datos.visitasPropiedad,
    contactos: datos.contactosPropiedad,
    envios: datos.enviosPropiedades,
    citas: datos.citas,
    recibos: datos.recibos,
    ahora,
    hoy,
  });
  const operaciones = construirOperacionesAtencion({
    recibos: datos.recibos,
    firmas: datos.firmas,
    citasFirma: datos.citasFirma,
    cierres: datos.cierres,
    ahora,
    hoy,
  });
  const poliza = construirPolizaAtencion({
    solicitudes: datos.solicitudes,
    firmas: datos.firmas,
    ahora,
  });
  const partners = construirPartnersAtencion({
    partners: datos.partnerOperations,
    ahora,
  });
  const dinero = construirDineroAtencion({
    cierres: datos.cierres,
    cierrePagos: datos.cierrePagos,
    resumenCentro,
  });

  const todas = ordenar([
    ...administracion,
    ...comercial,
    ...propiedades,
    ...operaciones,
    ...poliza,
    ...partners,
    ...dinero,
  ], 40);

  const atencionInmediata = ordenar(todas.filter((item) => ['P0', 'P1', 'P2'].includes(item.prioridad)), 10);

  return {
    filosofia: {
      pregunta_principal: '¿Qué necesita mi atención hoy?',
      modo: 'excepciones_reales',
      fuentes_reglas: [
        { key: 'sistema', label: 'Reglas automáticas del sistema', activo: true },
        { key: 'adn_emporio', label: 'Reglas de negocio ADN Emporio', activo: false },
      ],
      nota: 'La V1 usa reglas automáticas explicables. La arquitectura queda preparada para sumar reglas ADN Emporio sin cambiar la pantalla.',
    },
    resumen_excepciones: {
      ...resumenConteo(todas),
      por_area: todas.reduce((acc, item) => {
        acc[item.area] = (acc[item.area] || 0) + 1;
        return acc;
      }, {}),
    },
    atencion_inmediata: atencionInmediata,
    propiedades_atencion: ordenar(propiedades, 8),
    operaciones_atencion: ordenar([...operaciones, ...poliza, ...partners], 8),
    clientes_atencion: ordenar(comercial.filter((item) => item.area === 'Clientes' || item.area === 'Comercial'), 8),
    dinero_atencion: ordenar(dinero, 8),
  };
}
