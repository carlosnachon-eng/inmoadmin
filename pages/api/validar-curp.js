export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { curp, nombre_completo } = req.body;
  if (!curp) return res.status(400).json({ error: 'CURP requerida' });

  // Separar nombre y apellido si se proporcionan
  const partes = (nombre_completo || '').trim().split(' ').filter(Boolean);
  const first_name = partes[0] || '';
  const last_name = partes.slice(1).join(' ') || '';

  try {
    const params = new URLSearchParams();
    params.append('issuing_state', 'MEX');
    params.append('services', 'mex_curp');
    params.append('personal_number', curp.toUpperCase());
    if (first_name) params.append('first_name', first_name);
    if (last_name) params.append('last_name', last_name);

    const response = await fetch('https://verification.didit.me/v3/database-validation/', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.DIDIT_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    // TEMP DEBUG — quitar después de diagnosticar
    console.log('DIDIT RAW RESPONSE:', JSON.stringify(data));

    if (!response.ok) {
      return res.status(200).json({
        valido: false,
        resultado: 'error',
        mensaje: 'No se pudo verificar la CURP en este momento.',
        detalle: data,
      });
    }

    // La respuesta viene dentro de data.database_validation
    const dbVal = data.database_validation || data;
    const validacion = dbVal.validations?.[0];
    const match = dbVal.match_type;
    const sourceData = validacion?.source_data || {};

    // Interpretar resultado
    let valido = false;
    let resultado = 'no_match';
    let mensaje = '';
    let alertas = [];

    if (match === 'full_match' || match === 'partial_match') {
      valido = true;
      resultado = match;

      // Verificar si la CURP está activa
      const status = sourceData.curp_status || '';
      if (status.includes('Baja') || status.includes('BD') || status.includes('BAP')) {
        valido = false;
        resultado = 'curp_baja';
        alertas.push(`CURP con estatus irregular: ${status}`);
      }

      // Verificar coincidencia de nombre
      const nombreRENAPO = sourceData.full_name || '';
      if (nombreRENAPO && nombre_completo) {
        const normalizar = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        const palabrasForm = normalizar(nombre_completo).split(' ').filter(p => p.length > 2);
        const palabrasRENAPO = normalizar(nombreRENAPO);
        const coincidencias = palabrasForm.filter(p => palabrasRENAPO.includes(p)).length;
        if (coincidencias < 2) {
          alertas.push(`Nombre declarado ("${nombre_completo}") no coincide con RENAPO ("${nombreRENAPO}")`);
        }
      }

      mensaje = alertas.length > 0
        ? `CURP encontrada pero con observaciones.`
        : `CURP verificada correctamente en RENAPO.`;

    } else {
      resultado = 'no_match';
      mensaje = 'La CURP no fue encontrada en el registro de RENAPO.';
      alertas.push('CURP no encontrada en RENAPO');
    }

    return res.status(200).json({
      valido,
      resultado,
      mensaje,
      alertas,
      nombre_en_renapo: sourceData.full_name || null,
      curp_status: sourceData.curp_status || null,
      fecha_nacimiento: sourceData.date_of_birth || null,
      raw: data,
    });

  } catch (e) {
    console.error('Error validando CURP:', e.message);
    return res.status(200).json({
      valido: null,
      resultado: 'error',
      mensaje: 'No se pudo conectar con el servicio de verificación.',
      alertas: [],
    });
  }
}
