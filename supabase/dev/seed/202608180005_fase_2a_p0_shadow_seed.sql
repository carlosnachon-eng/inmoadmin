-- DEV ONLY. Dataset sintético FASE2A-P0; no contiene datos reales.
begin;
do $$
begin
  if to_regprocedure('public.ingest_shadow_message(jsonb,jsonb)') is null
     or coalesce(obj_description('public.shadow_messages'::regclass,'pg_class'),'') <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow' then
    raise exception 'Seed bloqueado: falta bootstrap P0 DEV';
  end if;
end $$;

do $$
declare r record; envelope jsonb; classification jsonb;
begin
  for r in select * from (values
    ('p0-01','Te mando el comprobante de la renta de agosto.','enviar_comprobante_renta','high'),
    ('p0-02','Sigue saliendo agua debajo del lavabo.','reportar_mantenimiento','high'),
    ('p0-03','¿Ya le pagaron al propietario?','propietario_liquidacion','high'),
    ('p0-04','¿Cuánto tengo que pagar de agua?','consulta_servicio','high'),
    ('p0-05','El técnico nunca llegó.','seguimiento_mantenimiento','high'),
    ('p0-06','Necesito sacar las llaves de X propiedad.','solicitud_llaves','high'),
    ('p0-07','Quiero cancelar el contrato.','contrato','high'),
    ('p0-08','Voy a pagar menos este mes porque hubo una fuga.','multintencion','high'),
    ('p0-09','Adjunto recibo de CFE.','enviar_comprobante_servicio','high'),
    ('p0-10','Necesito hablar con Carlos, esto ya es un problema legal.','queja_conflicto','high'),
    ('p0-11','Ya quedó resuelto el mantenimiento.','seguimiento_mantenimiento','high'),
    ('p0-12','¿Cuándo vence mi contrato?','contrato','high'),
    ('p0-13','No tengo luz.','emergencia','high'),
    ('p0-14','El propietario pregunta por su depósito.','propietario_liquidacion','high'),
    ('p0-15','Lo de la casa sigue igual.','no_determinado','medium'),
    ('p0-16','Adjunto la renta y el técnico nunca llegó.','multintencion','high'),
    ('p0-17','Hola','mensaje_social_spam','unknown'),
    ('p0-18','spam','mensaje_social_spam','low'),
    ('p0-19','El técnico solicita confirmar acceso mañana.','proveedor_seguimiento','medium'),
    ('p0-20','¿Qué pasó con las casas del propietario?','no_determinado','medium')
  ) as fixture(id,body,intent,likelihood)
  loop
    envelope := jsonb_build_object(
      'provider','synthetic','externalEventId','FASE2A-P0-event-'||r.id,
      'externalMessageId','FASE2A-P0-'||r.id,'externalConversationId','FASE2A-P0-conversation-'||r.id,
      'externalContactHash',encode(extensions.digest('FASE2A-P0-contact-'||r.id,'sha256'),'hex'),
      'channel','fixture','direction','inbound','occurredAt','2026-08-18T12:00:00.000Z',
      'sanitizedText',r.body,'sanitizationChanged',false,'sanitizationRejected',false,
      'attachmentMetadata','[]'::jsonb,'providerMetadata',jsonb_build_object('syntheticScenario',r.id,'area','administracion'),
      'payloadFingerprint',encode(extensions.digest('FASE2A-P0-'||r.id,'sha256'),'hex'));
    classification := jsonb_build_object('administrativeLikelihood',r.likelihood,'reasonCodes',jsonb_build_array('explicit_admin_area','synthetic_fixture'),'intent',r.intent,'requiresHuman',r.likelihood <> 'high' or r.intent='multintencion');
    perform public.ingest_shadow_message(envelope,classification);
  end loop;
end $$;
commit;
