# Resultados — 12 de noviembre de 2026

Base comparada: `18c11d251811ef84c0c6010da2749247b0bf3391` (`main` al iniciar). No se usaron credenciales, contactos ni datos de Producción.

| Comprobación | Resultado |
| --- | --- |
| Inventario, control, SDK y piloto privado incorporados al repo | 114/114 PASS |
| Regresiones existentes: router, HMAC, hold, identidad, Condominios, Shadow y atención humana | 186 PASS / 36 FAIL tanto en main limpio como en esta rama. Los 36 nombres de prueba coinciden; no hubo fallos nuevos. |
| Build Next.js 14.1.0, aplicación completa, entorno sintético, sin archivos .env | PASS; ambas rutas incluidas. Sin optimización de fuentes externas por falta de acceso a Google Fonts. |
| HTTP loopback y SDK Supabase con transporte interceptado | PASS; sin DB alojada ni tráfico a Respond.io. |
| SQL del control central | Copia exacta de referencia certificada: SHA-256 `1d0f60c8877163153c5784b33ba13f9ed69e18c85caae55528e4baf241849251`. No se ejecutó en esta ronda. |

Las pruebas de inventario cubren apagado por defecto, JWT de servicio rechazado, aislamiento DEV/Producción, rotación, expiración, control central previo y posterior, 429, consultas solo de publicados, límites, moneda y rechazo de datos privados. Las de Administración cubren revocación, ambigüedad, vigencia, importes, respuesta sin identificadores ni confirmación bancaria y alcance fijado por credencial. Condominios comprueba separación de tablas, versión de propiedad, huella, estado activo, revocación y múltiples unidades. El control global se ejercitó con el transporte simulado en esta ronda; su concurrencia PostgreSQL se había certificado en el piloto anterior.

Los fallos heredados se distribuyen así: 5 de ejecución comercial, 15 de procesamiento/recuperación comercial e intervención humana en las pruebas de inventario de redes, 14 de integración Shadow de Meta y 2 de retorno explícito de atención humana. Se ejecutaron con el hold vigente y fixtures históricos. No se alteraron las protecciones para hacerlos pasar.

Comando reproducible desde la raíz, con dependencias instaladas y permisos de loopback:

```sh
node --test tests/respondInventory*.test.mjs tests/respondAdminIdentityPilot.test.mjs \
  tests/respondChannelRouter.test.mjs tests/respondWebhookMultiHmac.test.mjs \
  tests/respondGrowthHold.test.mjs tests/shadowIdentityBridge.test.mjs \
  tests/condominiumCanonicalIdentity.test.mjs tests/salesInventoryOutcomes.test.mjs \
  tests/metaAdminShadowContext.test.mjs tests/humanAttention.test.mjs \
  tests/respondCommercialExecution.test.mjs
```

**Pendiente antes de activar:** verificar en Preview aislado el contrato HTTP con la skill de Advanced, su entrega a Carlos y las reglas de no duplicación en conversaciones de prueba. No se modificaron ni volvieron a certificar en vivo agentes o workflows. La identidad y las cuotas de Condominios para clientes reales siguen bloqueadas; ver [guía](README.md).
