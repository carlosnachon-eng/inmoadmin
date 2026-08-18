# Fase 1 — matriz del seed sintético DEV

Estado: preparado, **no ejecutado**. Namespace exclusivo: `FASE1-QA` y UUIDs
`f1…`. No contiene nombres, emails, teléfonos, direcciones ni documentos reales.

El smoke previo encontró dos gaps que bloquean su futura ejecución:
`properties.owner_email` no existe y `cash_movements` está ausente en DEV. El
seed aborta hasta que ambos se resuelvan mediante revisión de esquema separada.

| Escenario sintético | Regla esperada | Bucket esperado | Acción recomendada esperada |
|---|---|---|---|
| Servicio mensual +3 días | `servicio_proximo` | Próximos | Programar/validar pago |
| Servicio mensual -5 días | `servicio_vencido` | Vencidos | Confirmar pago |
| Servicio con comprobante | `comprobante_servicio_pendiente` | Para hoy | Validar comprobante |
| CFE bimestral sin ancla | `servicio_datos_inconsistentes` | Requiere autorización | Completar ancla/configuración |
| Predial anual sin ancla | `servicio_datos_inconsistentes` | Requiere autorización | Revisión manual |
| Gas por recarga | Sin regla periódica | No aparece | Ninguna |
| Servicio pagado por Emporio | `servicio_emporio_por_conciliar` | Requiere autorización | Conciliar gasto en liquidación |
| Renta recibida por Emporio | `liquidacion_pendiente` | Requiere autorización | Revisar y autorizar liquidación |
| Renta directa a propietario | Comisión devengada, saldo Emporio cero | No liquidación propia | Cobrar comisión por flujo separado |
| Propietario con cobro mixto | Liquidar sólo renta Emporio | Requiere autorización | Revisar cálculo compartido |
| Liquidación parcial | `liquidacion_parcial` | Requiere autorización | Autorizar saldo restante |
| Ticket urgente | `mantenimiento_sin_avance` | Críticos | Asignar acción inmediata |
| Ticket estancado 48 h | `mantenimiento_sin_avance` | Para hoy | Registrar avance |
| Cotización pendiente | `cotizacion_esperando_respuesta` | Esperando tercero | Solicitar aprobación |
| Mantenimiento previo owner | `mantenimiento_propietario_pendiente_descuento` | Requiere autorización | Revisar descuento |
| Ticket cerrado | Sin regla | No aparece | Ninguna |
| Llave en resguardo | Sin regla | No aparece | Ninguna |
| Llave fuera 12 h | Sin regla | No aparece | Ninguna |
| Llave fuera 30 h | `llave_fuera_resguardo` | Vencidos | Gestionar devolución |
| Llave fuera 80 h | `llave_fuera_resguardo` | Críticos | Gestionar devolución urgente |
| Renta atrasada | `renta_pendiente` | Críticos | Gestionar cobranza |
| Renta con comprobante | `comprobante_renta_pendiente` | Para hoy | Validar antes de cobrar |
| Transferencia sin evidencia | `evidencia_entrega_incompleta` | Requiere autorización | Adjuntar comprobante |
| Efectivo sin firma | `evidencia_entrega_incompleta` | Requiere autorización | Adjuntar firma |
| Contrato vence +20 días | `renovacion_contrato` | Próximos | Confirmar renovación/terminación |
| Tarea recurrente +2 días | Tarea recurrente próxima | Próximos | Confirmar ejecución |

El cleanup elimina exclusivamente UUIDs del namespace fijo y controles cuyo
`contextKey` contiene uno de esos identificadores. No toca el caso existente
`test:fase1:supervision:7eb7650e-8e49-4570-81a6-4c545f3b5d10`.
