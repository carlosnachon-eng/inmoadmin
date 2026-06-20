// pages/api/migrar-propiedades.js
//
// Jala TODAS las propiedades activas de EasyBroker, descarga sus fotos
// y las guarda en Supabase (tabla `propiedades` + bucket `propiedades-fotos`).
//
// Se corre UNA SOLA VEZ desde el botón en /propiedades-admin ("Importar de EasyBroker").
// Es seguro volver a correrlo: si una propiedad ya existe (mismo public_id), la actualiza
// en vez de duplicarla.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // necesita permisos de escritura completos, ver nota abajo
);

async function fetchEasyBrokerPage(page) {
  const params = new URLSearchParams();
  params.append("limit", "50");
  params.append("page", page);
  params.append("search[statuses][]", "published");
  params.append("search[statuses][]", "reserved");

  const url = `https://api.easybroker.com/v1/properties?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "X-Authorization": process.env.EASYBROKER_API_KEY,
      accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`EasyBroker respondió ${res.status}`);
  return res.json();
}

async function fetchEasyBrokerDetail(publicId) {
  const res = await fetch(`https://api.easybroker.com/v1/properties/${publicId}`, {
    headers: {
      "X-Authorization": process.env.EASYBROKER_API_KEY,
      accept: "application/json",
    },
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

    if (error) {
      console.error("Error subiendo foto:", error.message);
      return null;
    }

    const { data } = supabaseAdmin.storage.from("propiedades-fotos").getPublicUrl(fileName);
    return data.publicUrl;
  } catch (e) {
    console.error("Error descargando foto:", e.message);
    return null;
  }
}

function mapPropiedad(detalle) {
  const op = detalle.operations?.[0];
  const direccionPartes = [
    detalle.location?.street,
    detalle.location?.city_area,
  ].filter(Boolean);

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

  const resultado = { procesadas: 0, creadas: 0, actualizadas: 0, errores: [] };

  try {
    // 1) Traer el listado completo (todas las páginas)
    let page = 1;
    let todasLasPropiedades = [];
    while (true) {
      const data = await fetchEasyBrokerPage(page);
      const content = data.content || [];
      todasLasPropiedades = [...todasLasPropiedades, ...content];
      if (!data.pagination?.next_page) break;
      page++;
      if (page > 30) break; // límite de seguridad, ~1500 propiedades
    }

    // 2) Por cada propiedad, traer el detalle completo (fotos, amenidades, etc.)
    for (const resumen of todasLasPropiedades) {
      try {
        const detalle = await fetchEasyBrokerDetail(resumen.public_id);
        if (!detalle || detalle.error) {
          resultado.errores.push({ public_id: resumen.public_id, error: "No se pudo obtener el detalle" });
          continue;
        }

        const propiedadMapeada = mapPropiedad(detalle);

        // 3) Descargar y resubir las fotos a nuestro propio Storage
        const fotosOriginales = Array.isArray(detalle.property_images) ? detalle.property_images : [];
        const fotosSubidas = [];
        for (let i = 0; i < fotosOriginales.length; i++) {
          const urlOriginal = fotosOriginales[i]?.url;
          if (!urlOriginal) continue;
          const nuevaUrl = await descargarYSubirFoto(urlOriginal, detalle.public_id, i);
          if (nuevaUrl) fotosSubidas.push({ url: nuevaUrl, orden: i });
        }
        propiedadMapeada.fotos = fotosSubidas;

        // 4) Upsert en Supabase (si ya existe por public_id, actualiza; si no, crea)
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

        resultado.procesadas++;
      } catch (errProp) {
        resultado.errores.push({ public_id: resumen.public_id, error: errProp.message });
      }
    }

    return res.status(200).json(resultado);
  } catch (e) {
    return res.status(500).json({ error: e.message, parcial: resultado });
  }
}
