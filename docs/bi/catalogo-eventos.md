# V0-05 · Catálogo de unidades y eventos

Este catálogo define un lenguaje común para que cualquier módulo actual o futuro pueda integrarse al Centro de Inteligencia Empresarial sin reinventar criterios.

La regla principal es mantenerlo simple: el catálogo no calcula métricas, no sustituye las fuentes primarias y no modifica la operación. Solo clasifica unidades, eventos, estados y naturaleza económica.

## 1. Principios de uso

1. Cada dato debe conservar su fuente original.
2. Un evento describe algo que ocurrió o cambió; una métrica interpreta varios eventos o saldos.
3. El catálogo debe ayudar a comparar módulos distintos sin mezclarlos indebidamente.
4. Los fondos de terceros nunca deben confundirse con ingreso propio de Emporio.
5. Caja, generado, pendiente y pipeline son dimensiones distintas.
6. Si un módulo nuevo no encaja claramente, debe agregarse una nueva clave antes de forzarla dentro de otra categoría.

## 2. Unidades de negocio y dominios

Las unidades distinguen qué parte de la empresa origina o administra la información.

| Clave | Nombre para Dirección | Tipo | Uso principal |
|---|---|---:|---|
| `cierres` | Cierres inmobiliarios | Ingreso | Comisiones por ventas, rentas, apartados y cierres confirmados. |
| `administracion` | Administración de propiedades | Ingreso recurrente / operación | Rentas administradas, comisiones de administración, cobranza y liquidaciones a propietarios. |
| `poliza_juridica` | Póliza jurídica | Ingreso / riesgo | Expedientes, solicitudes, pagos de póliza, validaciones y riesgos documentales. |
| `mantenimiento` | Mantenimiento | Ingreso / costo / operación | Tickets, cotizaciones, costos, cobros y seguimiento operativo. |
| `condominios` | Condominios | Fondos de terceros / honorarios | Cuotas, gastos, saldos de condominio y posibles honorarios de Emporio. |
| `comercial` | Comercial y marketing | Pipeline | Leads, citas, seguimiento, conversión y calidad del pipeline. |
| `tesoreria` | Tesorería y caja | Caja / conciliación | Movimientos de efectivo, cuentas por cobrar, cuentas por pagar, conciliación y liquidez. |
| `equipo` | Equipo y productividad | Operación | Productividad por asesor, carga de trabajo, respuesta y cumplimiento. |
| `clientes` | Clientes y propietarios | Relación / riesgo | Calidad de cartera, concentración, satisfacción, recurrencia y exposición. |
| `corporativo` | Corporativo | Dirección | Metas, presupuestos, objetivos anuales, decisiones y seguimiento ejecutivo. |
| `otros` | Otros módulos | Extensión | Módulos futuros que aún no tengan clasificación propia. |

Nota: `tesoreria`, `equipo`, `clientes` y `corporativo` no siempre son unidades generadoras de ingreso; son dominios de inteligencia necesarios para Dirección.

## 3. Tipos de evento financiero

Los eventos financieros explican cómo cambia la posición económica o de caja.

| Clave | Qué significa | Clasificación típica |
|---|---|---|
| `ingreso_generado` | Se originó un derecho económico para Emporio, aunque todavía no se cobre. | Ingreso propio / cuenta por cobrar |
| `cobro_recibido` | Entró dinero a caja o banco. | Ingreso propio, fondos de terceros o recuperación |
| `cuenta_por_cobrar_creada` | Existe un importe pendiente de cobrar. | Cuenta por cobrar |
| `cuenta_por_cobrar_liquidada` | Se cobró total o parcialmente una cuenta pendiente. | Cuenta por cobrar |
| `fondo_tercero_recibido` | Emporio recibió dinero que pertenece a un propietario, condominio, cliente u otro tercero. | Fondos de terceros |
| `fondo_tercero_aplicado` | Se entregó, liquidó o aplicó dinero que no era ingreso propio de Emporio. | Fondos de terceros / cuenta por pagar |
| `costo_generado` | Se reconoció un costo necesario para producir o cumplir un servicio. | Costo |
| `pago_realizado` | Salió dinero de caja o banco. | Costo, fondo de tercero o cuenta por pagar |
| `cuenta_por_pagar_creada` | Existe una obligación pendiente de pago. | Cuenta por pagar |
| `cuenta_por_pagar_liquidada` | Se pagó total o parcialmente una obligación. | Cuenta por pagar |
| `reclasificacion` | Un importe cambia de naturaleza sin representar nuevo ingreso ni nueva salida física. | Reclasificación |
| `ajuste` | Corrección manual o contable que requiere evidencia. | Ajuste |
| `cancelacion` | Se anuló un ingreso, cobro, costo, cuenta por cobrar o cuenta por pagar. | Cancelación |

Regla: margen, flujo y neto para Emporio son métricas derivadas, no eventos primarios.

## 4. Tipos de evento comercial

Los eventos comerciales explican cómo avanza una oportunidad desde interés hasta cierre.

| Clave | Qué significa | Uso para Dirección |
|---|---|---|
| `visita_digital` | Una persona visitó una página, propiedad, proyecto o canal digital medible. | Demanda e intención inicial. |
| `lead_creado` | Se registró un prospecto identificable. | Entrada al pipeline. |
| `contacto_recibido` | El prospecto contactó por WhatsApp, teléfono, formulario u otro canal. | Conversión de interés a contacto. |
| `cita_agendada` | Se programó una cita. | Actividad comercial futura. |
| `cita_realizada` | La cita ocurrió efectivamente. | Calidad del seguimiento comercial. |
| `cita_cancelada` | La cita no ocurrió. | Riesgo de fuga o fricción operativa. |
| `propiedad_enviada` | Se compartió una propiedad o alternativa al cliente. | Actividad de asesoría. |
| `apartado_registrado` | Se registró apartado o intención económica inicial. | Oportunidad avanzada. |
| `abono_registrado` | Se registró un abono complementario. | Avance financiero previo al cierre. |
| `operacion_en_firma` | La operación entró a etapa documental o firma. | Probabilidad alta de cierre. |
| `cierre_confirmado` | La operación se convirtió en cierre. | Resultado comercial. |
| `oportunidad_perdida` | El prospecto u operación se perdió. | Aprendizaje comercial y forecast. |
| `renovacion_detectada` | Se identificó una posible renovación. | Pipeline recurrente. |

## 5. Tipos de evento operativo

Los eventos operativos explican la salud de ejecución, cumplimiento y riesgo.

| Clave | Qué significa | Uso para Dirección |
|---|---|---|
| `tarea_creada` | Se creó una actividad operativa. | Carga de trabajo. |
| `tarea_completada` | Se cerró una actividad operativa. | Productividad y cumplimiento. |
| `etapa_iniciada` | Un trámite, expediente, ticket o proceso cambió a una etapa activa. | Velocidad operativa. |
| `etapa_completada` | Una etapa del proceso quedó terminada. | Avance y cuellos de botella. |
| `documento_solicitado` | Se pidió un documento a cliente, propietario, asesor o proveedor. | Riesgo documental. |
| `documento_recibido` | Se recibió un documento requerido. | Reducción de riesgo. |
| `documento_generado` | El sistema generó un documento operativo o legal. | Evidencia y formalización. |
| `ticket_creado` | Se abrió un ticket o incidencia. | Demanda operativa. |
| `cotizacion_emitida` | Se emitió una cotización. | Potencial económico y carga. |
| `cotizacion_aprobada` | Una cotización fue aceptada. | Trabajo operativo comprometido. |
| `ticket_cerrado` | El ticket quedó terminado. | Cumplimiento y satisfacción. |
| `incidencia_detectada` | Se detectó un problema que requiere atención. | Riesgo operativo temprano. |
| `conciliacion_revisada` | Se revisó una conciliación o cruce de datos. | Control financiero. |

## 6. Convención de signos

Para evitar confusión entre módulos, la convención V0 es:

| Campo conceptual | Regla |
|---|---|
| Importe | Siempre se registra como número positivo. |
| Dirección económica | Se define con `direccion`: `entrada`, `salida` o `neutral`. |
| Naturaleza | Se define con `clasificacion`: ingreso propio, fondos de terceros, costo, cuenta por cobrar, cuenta por pagar o pipeline. |
| Caja | Solo existe cuando hay movimiento real o evidencia de cobro/pago. |
| Generado | Puede existir sin caja. |
| Pipeline | Representa probabilidad u oportunidad, no dinero ganado. |

No se deben usar importes negativos para representar salidas. Una salida es un importe positivo con `direccion = salida`.

Ejemplos:

| Caso | Importe | Dirección | Clasificación |
|---|---:|---|---|
| Comisión de cierre generada | Positivo | `entrada` | `ingreso_propio` |
| Renta cobrada para propietario | Positivo | `entrada` | `fondos_terceros` |
| Liquidación a propietario | Positivo | `salida` | `fondos_terceros` |
| Costo de mantenimiento | Positivo | `salida` | `costo` |
| Comisión pendiente de cobro | Positivo | `neutral` | `cuenta_por_cobrar` |
| Oportunidad en pipeline | Positivo | `neutral` | `pipeline` |

## 7. Estados normalizados

Estos estados permiten comparar módulos sin obligar a cambiar los estados internos actuales.

| Estado | Significado para Dirección |
|---|---|
| `borrador` | Existe, pero aún no debe afectar métricas ejecutivas. |
| `pendiente` | Requiere acción o validación. |
| `en_proceso` | Está activo y avanzando. |
| `parcial` | Tiene avance incompleto, por ejemplo cobro parcial o documentación parcial. |
| `confirmado` | Fue validado como real o aceptado. |
| `cobrado` | El ingreso o cuenta por cobrar fue cobrado. |
| `pagado` | La obligación o salida fue pagada. |
| `vencido` | Superó la fecha esperada sin resolverse. |
| `cancelado` | Fue anulado y no debe contar como activo. |
| `cerrado` | Terminó su ciclo operativo o financiero. |
| `conciliado` | Fue cruzado contra evidencia suficiente. |
| `requiere_revision` | Tiene ambigüedad, inconsistencia o falta evidencia. |
| `desconocido` | No se pudo mapear de forma confiable. |

Regla: los estados originales de cada tabla se conservan; el Centro de Inteligencia solo los traduce a un estado normalizado para análisis.

## 8. Clasificaciones económicas

| Clave | Qué incluye | Qué no debe incluir |
|---|---|---|
| `ingreso_propio` | Comisiones, honorarios, pólizas, utilidad o cargos que pertenecen a Emporio. | Rentas, cuotas o depósitos que pertenecen a terceros. |
| `fondos_terceros` | Rentas, cuotas de condominio, depósitos o recursos que Emporio administra pero no gana. | Utilidad, comisión u honorarios de Emporio. |
| `costo` | Pagos o costos necesarios para prestar un servicio o cerrar una operación. | Fondos entregados a terceros que nunca fueron costo de Emporio. |
| `cuenta_por_cobrar` | Derechos pendientes de cobro. | Pipeline sin obligación real. |
| `cuenta_por_pagar` | Obligaciones pendientes de pago. | Costos estimados aún no aprobados. |
| `pipeline` | Oportunidades, pronósticos, citas, leads o intención comercial todavía no ganada. | Ingresos confirmados o cobrados. |

Clasificaciones auxiliares permitidas para auditoría:

| Clave | Uso |
|---|---|
| `evidencia` | Documento, recibo o registro que soporta un evento, sin sumar por sí mismo. |
| `reclasificacion` | Movimiento interno que cambia naturaleza de un importe sin duplicar caja. |
| `no_financiero` | Evento operativo o comercial sin importe económico directo. |
| `ajuste` | Corrección controlada que requiere justificación. |

## 9. Regla mínima para integrar módulos futuros

Todo módulo nuevo que quiera alimentar el Centro de Inteligencia debe poder responder estas preguntas:

1. ¿A qué unidad o dominio pertenece?
2. ¿Qué tipo de evento genera?
3. ¿El importe es ingreso propio, fondo de tercero, costo, cuenta por cobrar, cuenta por pagar o pipeline?
4. ¿El evento representa caja real, derecho generado, obligación, evidencia o actividad?
5. ¿Cuál es su estado normalizado?
6. ¿Cuál es su identificador único para evitar duplicados?

Si alguna respuesta no existe, el módulo puede operar normalmente, pero no debe alimentar métricas ejecutivas hasta quedar mapeado.

## 10. Alcance de V0-05

Incluido:

- Lenguaje común de unidades, eventos, estados, signos y clasificaciones.
- Base para integrar módulos futuros sin mezclar fuentes.
- Catálogo entendible para Dirección y útil para desarrollo.

No incluido:

- Cambios en Supabase.
- Migraciones.
- RLS, Storage o permisos.
- Cambios en módulos operativos.
- Cálculos nuevos.
- Dashboard o visualizaciones.
