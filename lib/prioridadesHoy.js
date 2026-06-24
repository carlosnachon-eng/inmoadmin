const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const fechaValida = (valor) => {
  if (!valor) return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

export const horasDesde = (valor, ahora = new Date()) => {
  const fecha = fechaValida(valor);
  return fecha ? Math.max(0, (ahora.getTime() - fecha.getTime()) / HORA) : 0;
};

export const horasHasta = (valor, ahora = new Date()) => {
  const fecha = fechaValida(valor);
  return fecha ? (fecha.getTime() - ahora.getTime()) / HORA : null;
};

export const diasEntreFechas = (desde, hasta) => {
  if (!desde || !hasta) return null;
  const inicio = new Date(`${String(desde).slice(0, 10)}T12:00:00`);
  const fin = new Date(`${String(hasta).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;
  return Math.round((fin.getTime() - inicio.getTime()) / DIA);
};

export const crearPendiente = ({
  id,
  nivel,
  titulo,
  motivo,
  responsable,
  modulo,
  href,
  fechaReferencia,
  monto = 0,
  puntos = 0,
}) => ({
  id: String(id),
  nivel,
  titulo,
  motivo,
  responsable: responsable || "Por asignar",
  modulo,
  href,
  fechaReferencia: fechaReferencia || null,
  monto: Number(monto) || 0,
  puntuacion: Number(puntos) || 0,
});

export const ordenarPrioridades = (candidatos, limite = 5) => {
  const vistos = new Set();
  return (candidatos || [])
    .filter((item) => item && ["P0", "P1"].includes(item.nivel))
    .filter((item) => {
      if (vistos.has(item.id)) return false;
      vistos.add(item.id);
      return true;
    })
    .sort((a, b) => {
      if (a.nivel !== b.nivel) return a.nivel === "P0" ? -1 : 1;
      if (a.puntuacion !== b.puntuacion) return b.puntuacion - a.puntuacion;
      if (a.monto !== b.monto) return b.monto - a.monto;
      return new Date(a.fechaReferencia || 0) - new Date(b.fechaReferencia || 0);
    })
    .slice(0, limite);
};

export const resumenDeterminista = (pendientes) => {
  if (!pendientes?.length) return "Todo en orden por ahora";

  const p0 = pendientes.filter((item) => item.nivel === "P0").length;
  const modulos = [...new Set(pendientes.map((item) => item.modulo))];
  const encabezado = p0
    ? `Hay ${p0} asunto${p0 === 1 ? "" : "s"} crítico${p0 === 1 ? "" : "s"} que requiere${p0 === 1 ? "" : "n"} atención.`
    : `Hay ${pendientes.length} asunto${pendientes.length === 1 ? "" : "s"} prioritario${pendientes.length === 1 ? "" : "s"} para revisar.`;
  return `${encabezado}\nPrioriza ${pendientes[0].titulo.toLowerCase()}.\nMódulos involucrados: ${modulos.join(", ")}.`;
};
