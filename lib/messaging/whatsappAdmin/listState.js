// WhatsApp-only response validation. Never turn a malformed success into an empty inbox.
export function validateWhatsAppAdminList(result){
 if(!result||!Array.isArray(result.rows)||result.status?.mode!=='read_only'
  ||result.status?.sender!==false||result.status?.onboarding!==false)
  throw Error('whatsapp_list_contract_invalid');
 return result;
}

export function whatsappAdminListMessage({phase,filtered=false,count=0,environment='dev'}){
 if(phase==='error')return 'No se pudo consultar WhatsApp Administración. No se puede determinar si hay conversaciones.';
 if(phase!=='ready')return 'Consultando conversaciones autorizadas de WhatsApp Administración…';
 if(filtered)return 'No hay coincidencias con los filtros actuales.';
 if(count===0)return `Lectura autorizada completada en ${environment==='production'?'Producción':'DEV'}: 0 conversaciones disponibles.`;
 return `Historial autorizado de ${environment==='production'?'Producción':'DEV'}. Envíos desactivados.`;
}
