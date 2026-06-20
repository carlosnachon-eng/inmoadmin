// pages/api/migrar-propiedades.js
//
// Jala las propiedades activas de EasyBroker y las guarda en Supabase,
// EN LOTES PEQUEÑOS para respetar el límite de 10 segundos por llamada
// del plan Hobby de Vercel.
//
// Cómo funciona:
// - Cada llamada POST procesa como máximo BATCH_SIZE propiedades nuevas/pendientes.
// - Devuelve { listo: false, siguiente: true, ... } si todavía falta trabajo.
// - El botón "Importar de EasyBroker" en pantalla vuelve a llamar automáticamente
//   hasta que la respuesta diga { listo: true }.
// - Es seguro interrumpirlo y volver a darle: usa una tabla de control
//   (migracion_easybroker_estado) para saber qué public_ids ya procesó.

import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 4; // ~4 propiedades con fotos caben cómodamente en 10s

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchEasyBrokerPage(page) {
  const params = new URLSearchParams();
  params.append("limit", "50");
  params.append("page", page);
  params.append("search[statuses][]", "published");
  params.append("search[statuses][]", "reserved");

  const url = `https://api.easybroker.com/v1/properties?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "X-Authorization": process.env.EASYBROKER_API_KEY, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`EasyBroker respondió ${res.status}`);
  return res.json();
}

async function fetchEasyBrokerDetail(publicId) {
  const res = await fetch(`https://api.easybroker.com/v1/properties/${publicId}`, {
    headers: { "X-Authorization": process.env.EASYBROKER_API_KEY, accept: "application/json" },
  });
  if (!res.ok) return null;
  return res.json();
}

async function descargarYSubirFoto(url, publicId, index) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = (url.split(".").pop() || "jpg").split("?")[0].slice(0, 4);
    const fileName = `${publicId}/${index}_${Date.now()}.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("propiedades-fotos")
      .upload(fileName, buffer, { upsert: true, contentType: res.headers.get("content-type") || "image/jpeg" });
    if (error) return null;
    const { data } = supabaseAdmin.storage.from("propiedades-fotos").getPublicUrl(fileName);
    return data.publicUrl;
  } catch {
    return null;
  }
}

function mapPropiedad(detalle) {
  const op = detalle.operations?.[0];
  const direccionPartes = [detalle.location?.street, detalle.location?.city_area].filter(Boolean);
  return {
    public_id: detalle.public_id,
    titulo: detalle.title || "Propiedad sin título",
    descripcion: typeof detalle.description === "string" ? detalle.description : "",
    operacion: op?.type === "sale" ? "sale" : "rental",
    precio: op?.amount || 0,
    moneda: op?.currency || "MXN",
    unidad_precio: op?.unit === "total" ? "total" : "mensual",
    tipo: detalle.property_type || null,
    recamaras: detalle.bedrooms || 0,
    banos: detalle.bathrooms || 0,
    estacionamientos: detalle.parking_spaces || 0,
    m2_construccion: detalle.construction_size || 0,
    m2_terreno: detalle.lot_size || 0,
    direccion: direccionPartes.join(", "),
    colonia: detalle.location?.city_area || null,
    ciudad: detalle.location?.city || "Puebla",
    estado: detalle.location?.region || "Puebla",
    lat: detalle.location?.latitude || null,
    lng: detalle.location?.longitude || null,
    mostrar_ubicacion_exacta: !!detalle.location?.show_exact_location,
    amenidades: Array.isArray(detalle.amenities)
      ? detalle.amenities.map(a => (typeof a === "string" ? a : a.name)).filter(Boolean)
      : [],
    status: detalle.status || "published",
    origen: "easybroker_migracion",
  };
}

async function obtenerListaCompleta(forzarRecarga) {
  // Si ya tenemos la lista completa guardada en esta corrida de migración, la reutilizamos
  // (se guarda en la tabla de control para no volver a pedirla en cada lote).
  // EXCEPCIÓN: si forzarRecarga viene true, ignoramos lo guardado y volvemos a
  // preguntarle a EasyBroker — esto es importante porque si la lista guardada
  // quedó corta por algún motivo, nunca se vuelve a corregir sola.
  if (!forzarRecarga) {
    const { data: control } = await supabaseAdmin
      .from("migracion_easybroker_estado")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (control?.lista_public_ids?.length > 0) {
      return { publicIds: control.lista_public_ids, vinoDeCache: true };
    }
  }

  // Pedimos todas las páginas de EasyBroker (esto es rápido, son requests ligeros sin fotos)
  let page = 1;
  let todas = [];
  while (true) {
    const data = await fetchEasyBrokerPage(page);
    const content = data.content || [];
    todas = [...todas, ...content];
    if (content.length === 0 || content.length < 50) break;
    page++;
    if (page > 60) break;
  }
  const publicIds = todas.map(p => p.public_id);

  await supabaseAdmin.from("migracion_easybroker_estado").upsert({
    id: 1,
    lista_public_ids: publicIds,
    procesados: [],
    total: publicIds.length,
    iniciado_en: new Date().toISOString(),
  });

  return { publicIds, vinoDeCache: false };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Usa POST para ejecutar la migración" });
  }
  if (!process.env.EASYBROKER_API_KEY) {
    return res.status(500).json({ error: "Falta EASYBROKER_API_KEY en las variables de entorno" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno" });
  }

  const resultado = { creadas: 0, actualizadas: 0, errores: [] };

  try {
    const forzarRecarga = req.body?.forzarRecarga === true;
    const { publicIds: todosLosIds, vinoDeCache } = await obtenerListaCompleta(forzarRecarga);

    const { data: control } = await supabaseAdmin
      .from("migracion_easybroker_estado")
      .select("*")
      .eq("id", 1)
      .single();

    const yaProcesados = new Set(control.procesados || []);
    const pendientes = todosLosIds.filter(id => !yaProcesados.has(id));

    if (pendientes.length === 0) {
      // Ya no falta nada: limpiamos la tabla de control para la próxima vez que se use
      await supabaseAdmin.from("migracion_easybroker_estado").delete().eq("id", 1);
      return res.status(200).json({
        listo: true,
        total: todosLosIds.length,
        total_reportado_por_easybroker: todosLosIds.length,
        vino_de_cache: vinoDeCache,
        mensaje: "Migración completa, no quedan propiedades pendientes.",
      });
    }

    const loteActual = pendientes.slice(0, BATCH_SIZE);

    for (const publicId of loteActual) {
      try {
        const detalle = await fetchEasyBrokerDetail(publicId);
        if (!detalle || detalle.error) {
          resultado.errores.push({ public_id: publicId, error: "No se pudo obtener el detalle" });
          continue;
        }

        const propiedadMapeada = mapPropiedad(detalle);

        const fotosOriginales = Array.isArray(detalle.property_images) ? detalle.property_images : [];
        const fotosSubidas = [];
        for (let i = 0; i < fotosOriginales.length; i++) {
          const urlOriginal = fotosOriginales[i]?.url;
          if (!urlOriginal) continue;
          const nuevaUrl = await descargarYSubirFoto(urlOriginal, detalle.public_id, i);
          if (nuevaUrl) fotosSubidas.push({ url: nuevaUrl, orden: i });
        }
        propiedadMapeada.fotos = fotosSubidas;

        const { data: existente } = await supabaseAdmin
          .from("propiedades")
          .select("id")
          .eq("public_id", propiedadMapeada.public_id)
          .maybeSingle();

        if (existente) {
          await supabaseAdmin.from("propiedades").update(propiedadMapeada).eq("id", existente.id);
          resultado.actualizadas++;
        } else {
          await supabaseAdmin.from("propiedades").insert(propiedadMapeada);
          resultado.creadas++;
        }
      } catch (errProp) {
        resultado.errores.push({ public_id: publicId, error: errProp.message });
      }
    }

    // Marcamos este lote como procesado (independientemente de si tuvo error,
    // para no atorarnos infinitamente en una propiedad problemática)
    const nuevosProcesados = [...(control.procesados || []), ...loteActual];
    await supabaseAdmin
      .from("migracion_easybroker_estado")
      .update({ procesados: nuevosProcesados })
      .eq("id", 1);

    return res.status(200).json({
      listo: false,
      procesados_en_este_lote: loteActual.length,
      total_procesados_hasta_ahora: nuevosProcesados.length,
      total: todosLosIds.length,
      vino_de_cache: vinoDeCache,
      ...resultado,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, parcial: resultado });
  }
}
