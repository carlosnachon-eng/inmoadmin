# ImoAdmin — Documentación del Sistema
**Emporio Inmobiliario** · Versión actual: Junio 2026

---

## ¿Qué es ImoAdmin?

ImoAdmin es el sistema de gestión interna de Emporio Inmobiliario. Es una aplicación web privada que centraliza toda la operación: propiedades, contratos, cobros, comisiones, póliza jurídica, mantenimiento, finanzas y generación automática de documentos legales.

**Tecnología:** Next.js + Supabase (base de datos y almacenamiento en la nube)
**Acceso:** Solo con usuario y contraseña (sistema de login con roles)
**Idioma:** Español, moneda MXN

---

## ¿Quién puede usar qué?

| Rol | Permisos |
|---|---|
| **Admin** | Todo: crear, editar, eliminar, ver finanzas completas |
| **Usuario normal** | Ver y editar, pero NO puede eliminar registros |

Los roles se asignan en la base de datos (tabla `profiles`).

---

## Módulos del sistema

### 1. Panel de Control (Dashboard)
**Pantalla principal al entrar al sistema.**

Muestra en tiempo real:
- Renta mensual total (propiedades ocupadas)
- Cobrado / Pendiente / Atrasado del mes
- Comisiones del mes y comisiones pendientes de cobro
- Saldo de caja actual
- Cobros del mes en curso
- Últimos movimientos de caja
- Alertas de comprobantes de servicios en revisión

---

### 2. Propiedades
**Catálogo de todas las propiedades que administra la inmobiliaria.**

Tipos de propiedad: Departamento, Casa, Local comercial, Bodega, Oficina

**Estatus posibles:**
- 🟣 Disponible — Sin inquilino activo
- 🟢 Ocupada — Con contrato vigente
- 🩷 En mantenimiento — Temporalmente fuera de operación

**Por cada propiedad se puede:**
- Registrar datos: nombre, dirección, tipo, renta mensual, email y teléfono del propietario
- Subir el contrato de arrendamiento en PDF
- Ver y registrar gastos operativos (agua, luz, predial, condominio, etc.)
- Gestionar servicios del inmueble (ver más abajo)

**Semáforo de servicios:** Cada tarjeta de propiedad muestra el estado de sus servicios del mes: ✅ Al día / 🔍 En revisión / 🔴 Pendiente / ⏳ Sin pagar.

---

### 3. Servicios de Inmuebles
**Control de pagos de servicios (luz, agua, gas, mantenimiento, etc.) por propiedad.**

Servicios que se pueden configurar:
- ⚡ Luz (CFE) — bimestral
- 💧 Agua — mensual
- 🔥 Gas mensual / Gas recarga
- 🏢 Mantenimiento — mensual
- 🌐 Internet — mensual
- 🏛️ Predial/Limpia — anual

**Por cada servicio se define:**
- ¿Quién paga? Inquilino / Propietario / Incluido en renta
- Día límite de pago
- Número de cuenta o contrato
- Notas

**Flujo de comprobantes:**
1. El inquilino o admin sube el comprobante de pago
2. El sistema lo marca "En revisión"
3. El admin aprueba o rechaza desde el dashboard

---

### 4. Cobranza
**Registro y seguimiento de pagos de renta por inquilino.**

Estatus de pagos: Pagado ✅ / Pendiente ⏳ / Atrasado 🔴 / En revisión 🔍

---

### 5. Contratos
**Gestión de contratos de arrendamiento activos.**

Datos que maneja:
- Tipo de contrato (habitacional, amueblado, comercial)
- Comisión (porcentaje o monto fijo)
- Quién recibe la renta: la inmobiliaria o el propietario directamente
- Estado de comisión (pendiente de cobro / cobrada)

---

### 6. Caja
**Control de entradas y salidas de dinero de la inmobiliaria.**

Categorías de entradas: Renta cobrada, Comisión cobrada, Mantenimiento cobrado, Anticipo mantenimiento, Liquidación propietario, Otro

Categorías de salidas: Gasto operativo, Pago proveedor, Material/Refacción, Otro

---

### 7. Comisiones
**Seguimiento de comisiones por contrato activo.**

Calcula automáticamente la comisión según si es porcentaje o monto fijo de la renta. Diferencia entre comisiones totales del mes y comisiones pendientes de cobro.

---

### 8. Liquidaciones
**Liquidaciones a propietarios** — Cálculo de lo que se le entrega al dueño de cada propiedad después de descontar comisiones y gastos.

---

### 9. Finanzas
**Vista financiera consolidada del negocio.**

---

### 10. Reportes
**Reportes exportables de la operación.**

---

### 11. Mantenimiento
**Control de solicitudes y trabajos de mantenimiento por propiedad.**

---

### 12. KPIs y Dashboard de KPIs
**Indicadores clave del negocio.** Hay dos vistas: `kpis.js` (operativa) y `kpis-dashboard.js` (ejecutiva).

---

### 13. Póliza Jurídica
**Módulo completo para el área legal — administrado por la abogada interna.**

Secciones:
- **Solicitudes** — Solicitudes de póliza jurídica entrantes
- **Expedientes** — Historial de casos abiertos y cerrados
- **Propietarios** — Catálogo de propietarios con póliza
- **Compraventa** — Procesos de compraventa con documentación (promesa, contrato, compradores, vendedores)
- **Caja Póliza** — Control financiero del área jurídica
- **Documentos** — Generación de documentos legales por folio

---

### 14. Firmas Digitales
**Flujo de firma electrónica de documentos.**

Las firmas avanzan por etapas. El sistema lleva el historial de cada proceso de firma y su estado actual.

---

### 15. Registros Externos
Formularios públicos para que clientes o propietarios ingresen su información:
- `/registro-comprador` — Formulario para compradores
- `/registro-propietario` — Formulario para propietarios
- `/registro-vendedor` — Formulario para vendedores
- `/solicitud` — Solicitud general
- `/solicitud-inquilino` — Solicitud específica para inquilinos

---

## Documentos que genera automáticamente

ImoAdmin genera documentos legales en formato Word (.docx) directamente desde el sistema, sin necesidad de escribirlos a mano:

| Documento | Archivo |
|---|---|
| Contrato de arrendamiento (habitacional, amueblado, comercial) | `lib/generarContrato.js` |
| Contrato de administración de inmueble | `lib/generarContratoAdministracion.js` |
| Contrato de compraventa | `lib/generarContratoCompraventa.js` |
| Contrato de promoción (venta) | `lib/generarContratoPromocion.js` |
| Contrato de promoción (arrendamiento) | `lib/generarContratoPromocionArrendamiento.js` |
| Promesa de compraventa | `lib/generarPromesaCompraventa.js` |
| Pagarés | `lib/generarPagares.js` |
| Póliza jurídica | `lib/generarPoliza.js` |
| Recibos de pago | `lib/generarRecibo.js` |
| Dictamen jurídico | `scripts/generate_dictamen.py` |

---

## Automatizaciones activas

| Automatización | Archivo | Descripción |
|---|---|---|
| Recordatorios automáticos | `pages/api/cron-recordatorios.js` | Se ejecuta en horario programado para enviar recordatorios de pago |
| Respuesta automática a leads | `pages/api/respond-leads.js` | Responde automáticamente a prospectos que contactan por propiedades |
| Webhook de respuestas | `pages/api/webhook-respond.js` | Procesa eventos entrantes de terceros |
| Contacto de propiedad | `pages/api/contacto-propiedad.js` | Gestiona el formulario de contacto del portal |
| Envío de emails | `pages/api/send-email.js` | Servicio interno de envío de correos |
| Generación de dictamen | `pages/api/generar-dictamen.js` | Genera dictámenes jurídicos en PDF con IA |

---

## Base de datos (tablas principales en Supabase)

| Tabla | ¿Qué guarda? |
|---|---|
| `profiles` | Usuarios del sistema y sus roles |
| `properties` | Propiedades del catálogo |
| `contracts` | Contratos de arrendamiento activos |
| `payments` | Cobros de renta por mes |
| `cash_movements` | Movimientos de caja (entradas y salidas) |
| `property_expenses` | Gastos operativos por propiedad |
| `servicios_inmueble` | Configuración de servicios por propiedad |
| `pagos_servicios` | Registro de pagos de servicios por periodo |

**Almacenamiento (Storage):**
- `contratos` — PDFs de contratos subidos por propiedad
- `receipts` — Comprobantes de pago de servicios

---

## Flujos más importantes

### ¿Cómo se registra un nuevo inquilino?
1. Se crea la propiedad (si no existe) en el módulo Propiedades
2. Se genera el contrato de arrendamiento desde el módulo Contratos
3. Se sube el PDF del contrato firmado a la propiedad
4. Se configura el cobro mensual en Cobranza
5. Se configuran los servicios del inmueble

### ¿Cómo se cobran las comisiones?
1. En Contratos se define si la comisión es % o monto fijo
2. El sistema calcula automáticamente el total mensual
3. En el módulo Comisiones se marca si ya fue cobrada o está pendiente
4. Al marcar cobrada, se registra el ingreso en Caja

### ¿Cómo funciona la póliza jurídica?
1. El propietario solicita la póliza
2. La abogada crea un expediente en el módulo Póliza
3. Se genera la documentación jurídica automáticamente
4. El expediente se mantiene activo mientras dura la póliza
5. La póliza se puede renovar desde el módulo

---

## Acceso y soporte

- **URL del sistema:** (interna — acceso solo con credenciales)
- **Base de datos:** Supabase (dashboard en supabase.com)
- **Despliegue:** Vercel (configuración en `vercel.json`)
- **Código fuente:** GitHub — carpeta `inmoadmin`
- **Responsable técnico:** Director General (Carlos Nachon) con apoyo de Claude AI

---

*Documentación generada con Cowork · Emporio Inmobiliario · Junio 2026*
