const clean = (value) => typeof value === 'string' ? value.trim() : value

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
      fuente: 'Solicitud original (campo histórico)',
      nombre: clean(solicitud.nombre_aval),
      telefono: clean(solicitud.telefono_aval),
      domicilio: clean(solicitud.domicilio_aval),
      ocupacion: clean(solicitud.ocupacion_aval),
      relacion: null,
      tieneDocumentos: Boolean(solicitud.doc_identificacion_aval || solicitud.doc_comprobante_aval),
    }] : []),
    ...partnerParticipants.map(participant => ({
      id: participant.id,
      fuente: 'Participante vinculado por operación Partner',
      nombre: clean(participant.nombre),
      telefono: clean(participant.telefono),
      correo: clean(participant.email),
      domicilio: clean(participant.data_json?.domicilio),
      ocupacion: clean(participant.data_json?.ocupacion),
      relacion: clean(participant.data_json?.relacion_inquilino),
      tieneDocumentos: Array.isArray(participant.docs_json) && participant.docs_json.length > 0,
    })),
  ],
})

export const hasAnyValue = (object = {}) => Object.values(object).some(Boolean)
