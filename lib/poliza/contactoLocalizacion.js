const clean = (value) => typeof value === 'string' ? value.trim() : value

export const SOLICITUD_FIELDS = [
  'id', 'telefono', 'correo', 'domicilio_actual', 'empresa_labora', 'razon_social',
  'giro_comercial', 'giro_empresa_labora', 'giro_empresa', 'ocupacion',
  'domicilio_trabajo', 'telefono_trabajo', 'nombre_jefe', 'puesto_jefe',
  'telefono_email_jefe', 'nombre_conyuge', 'telefono_conyuge',
  'nombre_arrendador_actual', 'telefono_arrendador_actual',
  'ref_fam1_nombre', 'ref_fam1_parentesco', 'ref_fam1_telefono',
  'ref_fam2_nombre', 'ref_fam2_parentesco', 'ref_fam2_telefono',
  'ref_fam3_nombre', 'ref_fam3_parentesco', 'ref_fam3_telefono',
  'ref_per1_nombre', 'ref_per1_relacion', 'ref_per1_telefono',
  'ref_per2_nombre', 'ref_per2_relacion', 'ref_per2_telefono',
  'ref_per3_nombre', 'ref_per3_relacion', 'ref_per3_telefono',
  'nombre_aval', 'telefono_aval', 'domicilio_aval', 'ocupacion_aval',
].join(', ')

export const OPERATION_FIELDS = 'id, partner_agency_id, solicitud_inquilino_id, poliza_expediente_id'
export const PARTICIPANT_FIELDS = [
  'id', 'partner_operation_id', 'partner_agency_id', 'role', 'status', 'nombre', 'email', 'telefono',
  'domicilio:data_json->>domicilio', 'ocupacion:data_json->>ocupacion',
  'relacion_inquilino:data_json->>relacion_inquilino',
].join(', ')

export async function loadContactLocation(client, { solicitudId, expedienteId, readParticipants }) {
  const pending = []
  const read = async (label, query) => {
    try {
      const { data, error } = await query()
      if (error) throw error
      return data
    } catch {
      pending.push(`${label}: consulta pendiente; no fue posible recuperar esta fuente con el acceso actual.`)
      return null
    }
  }

  // Each source can succeed even when another source is missing or denied by RLS.
  const [solicitud, byExpediente, bySolicitud] = await Promise.all([
    solicitudId ? read('Solicitud original', () => client.from('solicitudes_inquilino')
      .select(SOLICITUD_FIELDS).eq('id', solicitudId).maybeSingle()) : null,
    expedienteId ? read('Operación vinculada al expediente', () => client.from('partner_operations')
      .select(OPERATION_FIELDS).eq('poliza_expediente_id', expedienteId)) : [],
    solicitudId ? read('Operación vinculada a la solicitud', () => client.from('partner_operations')
      .select(OPERATION_FIELDS).eq('solicitud_inquilino_id', solicitudId)) : [],
  ])
  if (!solicitud) pending.push(solicitudId
    ? 'Solicitud original: no disponible o no accesible. Se conservan las otras fuentes recuperadas.'
    : 'Solicitud original: sin ID vinculado. Se consultó el expediente de forma independiente.')

  const operations = [...new Map([...(byExpediente || []), ...(bySolicitud || [])]
    .map(operation => [operation.id, operation])).values()]
  const compatible = operations.filter(operation => {
    const linked = (expedienteId && operation.poliza_expediente_id === expedienteId)
      || (solicitudId && operation.solicitud_inquilino_id === solicitudId)
    const conflict = !linked || !operation.id || !operation.partner_agency_id
      || (expedienteId && operation.poliza_expediente_id && operation.poliza_expediente_id !== expedienteId)
      || (solicitudId && operation.solicitud_inquilino_id && operation.solicitud_inquilino_id !== solicitudId)
    if (conflict) pending.push('Operación Partner: relación incompatible; no se consultaron sus participantes.')
    return !conflict
  })

  let participants = []
  if (compatible.length === 1) {
    const operation = compatible[0]
    const rows = await read('Participantes Partner', () => readParticipants ? readParticipants(operation) : client.from('partner_participants')
      .select(PARTICIPANT_FIELDS)
      .eq('partner_operation_id', operation.id)
      .eq('partner_agency_id', operation.partner_agency_id)
      .eq('role', 'obligado_solidario').neq('status', 'cancelado'))
    participants = (rows || []).filter(participant =>
      participant.partner_operation_id === operation.id
      && participant.partner_agency_id === operation.partner_agency_id
      && participant.role === 'obligado_solidario' && participant.status !== 'cancelado')
    if (!participants.length) pending.push('Obligado solidario Partner: no disponible o no accesible en la operación vinculada.')
  } else if (compatible.length > 1) {
    pending.push('Operación Partner: hay varios vínculos posibles; consulta de participantes pendiente de aclarar la relación.')
  } else {
    pending.push('Operación Partner: sin vínculo disponible o accesible por ID.')
  }

  return { solicitud, location: buildContactLocation(solicitud || {}, participants), pending: [...new Set(pending)] }
}

export const buildReferences = (solicitud = {}) => {
  const references = []
  for (let index = 1; index <= 3; index += 1) {
    const familiar = {
      id: `familiar-${index}`,
      tipo: 'Familiar',
      nombre: clean(solicitud[`ref_fam${index}_nombre`]),
      relacion: clean(solicitud[`ref_fam${index}_parentesco`]),
      telefono: clean(solicitud[`ref_fam${index}_telefono`]),
    }
    if (familiar.nombre || familiar.telefono) references.push(familiar)

    const personal = {
      id: `personal-${index}`,
      tipo: 'Personal',
      nombre: clean(solicitud[`ref_per${index}_nombre`]),
      relacion: clean(solicitud[`ref_per${index}_relacion`]),
      telefono: clean(solicitud[`ref_per${index}_telefono`]),
    }
    if (personal.nombre || personal.telefono) references.push(personal)
  }
  return references
}

export const buildContactLocation = (solicitud = {}, partnerParticipants = []) => ({
  principal: {
    telefono: clean(solicitud.telefono),
    correo: clean(solicitud.correo),
    domicilioDeclarado: clean(solicitud.domicilio_actual),
  },
  laboral: {
    empleador: clean(solicitud.empresa_labora || solicitud.razon_social || solicitud.giro_comercial),
    actividad: clean(solicitud.giro_empresa_labora || solicitud.giro_empresa || solicitud.ocupacion),
    domicilio: clean(solicitud.domicilio_trabajo),
    telefono: clean(solicitud.telefono_trabajo),
    contacto: clean(solicitud.nombre_jefe),
    puesto: clean(solicitud.puesto_jefe),
    telefonoCorreoContacto: clean(solicitud.telefono_email_jefe),
  },
  conyuge: {
    nombre: clean(solicitud.nombre_conyuge),
    telefono: clean(solicitud.telefono_conyuge),
  },
  arrendadorAnterior: {
    nombre: clean(solicitud.nombre_arrendador_actual),
    telefono: clean(solicitud.telefono_arrendador_actual),
  },
  referencias: buildReferences(solicitud),
  obligados: [
    ...(solicitud.nombre_aval || solicitud.telefono_aval || solicitud.domicilio_aval ? [{
      id: `solicitud-${solicitud.id || 'sin-id'}`,
      denominacion: 'Aval declarado — registro histórico',
      fuente: 'Solicitud original (campo histórico)',
      nombre: clean(solicitud.nombre_aval),
      telefono: clean(solicitud.telefono_aval),
      domicilio: clean(solicitud.domicilio_aval),
      ocupacion: clean(solicitud.ocupacion_aval),
      relacion: null,
    }] : []),
    ...partnerParticipants.filter(participant => participant.role === 'obligado_solidario').map(participant => ({
      id: participant.id,
      denominacion: 'Obligado solidario — participante registrado',
      fuente: 'Participante vinculado por operación Partner',
      nombre: clean(participant.nombre),
      telefono: clean(participant.telefono),
      correo: clean(participant.email),
      domicilio: clean(participant.domicilio),
      ocupacion: clean(participant.ocupacion),
      relacion: clean(participant.relacion_inquilino),
    })),
  ],
})

export const hasAnyValue = (object = {}) => Object.values(object).some(Boolean)
