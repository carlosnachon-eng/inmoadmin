# Modelo de autorización — condominios

Fecha: 17 de julio de 2026
Principio: denegar por defecto; autorización en base de datos y servidor, nunca sólo en interfaz.

## Dimensiones de alcance

Toda decisión combina:

1. **Identidad:** `auth.uid()`.
2. **Membresía:** fila activa en `condominio_miembros`.
3. **Rol condominal:** función de la persona dentro de ese condominio.
4. **Condominio:** `condominio_id` exacto o membresía global explícita.
5. **Unidad:** requerida para condómino/residente.
6. **Acción:** verbo explícito, no un booleano genérico de edición.
7. **Estado:** periodo abierto/cerrado y registro activo/reversado.

`profiles.role_id` sigue sirviendo para el menú general. El control P0 del módulo se basa en `condominio_miembros`; ser usuario autenticado o tener visible el módulo no concede acceso a datos.

## Roles

| Rol | Alcance |
|---|---|
| `direccion` | Global; gobierno, exportación, cierre/reapertura y usuarios |
| `administrador_general` | Global o condominios asignados; operación completa excepto cambios reservados a Dirección |
| `lider_cuenta` | Condominios asignados; operación, cierre y exportación |
| `cobranza` | Condominios asignados; consulta, pagos y cobranza |
| `mantenimiento` | Condominios asignados; documentos y gastos operativos; no finanzas completas |
| `juridico` | Condominios asignados; consulta, documentos y exportación autorizada |
| `comite` | Un condominio; consulta completa, autorización y exportación sin administrar usuarios internos |
| `condomino` | Una o varias unidades explícitas; consulta propia, recibos y comprobantes propios |
| `residente` | Una o varias unidades explícitas; consulta limitada y comprobantes propios |
| `solo_lectura` | Condominio asignado; consulta, sin documentos sensibles salvo concesión específica |

Una persona con varias unidades tiene una membresía por unidad o una membresía con `unidad_id` nula sólo cuando su rol permite alcance condominal. No se resuelve identidad por coincidencia libre de email.

## Acciones canónicas

- `consultar`
- `crear`
- `editar`
- `autorizar`
- `registrar_pago`
- `registrar_gasto`
- `reversar`
- `cerrar_periodo`
- `reabrir_periodo`
- `exportar`
- `administrar_usuarios`
- `importar_unidades`
- `generar_cuotas`
- `enviar_recibo`
- `subir_documento`

## Matriz

Leyenda: ✓ permitido dentro de alcance; P propio/propias unidades; A sólo contenido operativo asignado; — denegado.

| Acción | Dirección | Admin. general | Líder | Cobranza | Mtto. | Jurídico | Comité | Condómino | Residente | Lectura |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Consultar condominio | ✓ | ✓ | ✓ | ✓ | A | ✓ | ✓ | P | P | ✓ |
| Crear condominio | ✓ | ✓ | — | — | — | — | — | — | — | — |
| Editar configuración | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| Consultar unidades | ✓ | ✓ | ✓ | ✓ | A | ✓ | ✓ | P | P | ✓ |
| Importar unidades | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| Generar cuotas | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| Registrar pago | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| Registrar gasto | ✓ | ✓ | ✓ | — | ✓* | — | — | — | — | — |
| Autorizar gasto | ✓ | ✓ | ✓ | — | — | — | ✓ | — | — | — |
| Reversar | ✓ | ✓ | ✓ | ✓** | — | — | — | — | — | — |
| Cerrar periodo | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| Reabrir periodo | ✓ | — | — | — | — | — | — | — | — | — |
| Exportar expediente | ✓ | ✓ | ✓ | — | — | ✓ | ✓ | — | — | — |
| Administrar usuarios | ✓ | ✓ | — | — | — | — | — | — | — | — |
| Subir comprobante propio | ✓ | ✓ | ✓ | ✓ | A | ✓ | ✓ | P | P | — |
| Enviar recibo | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — |

\* Mantenimiento puede proponer/registrar gasto sólo si el flujo exige autorización posterior; para P0 el endpoint lo limita a usuarios con `registrar_gasto`.
\** Cobranza puede reversar pagos con motivo; no gastos.

## Documentos

Cada objeto en `condominio_documentos` contiene `condominio_id`, `unidad_id` opcional, `categoria`, bucket/path privado, MIME, tamaño, hash y retención.

- Internos operativos: según rol y condominio.
- Comprobante de pago: usuario de la unidad y cobranza/roles superiores.
- Recibo: usuario de la unidad y cobranza/roles superiores.
- Comprobantes de gasto: comité y roles internos con consulta financiera.
- Jurídicos: Jurídico, Dirección, Admin y comité cuando se marque compartido.
- URL firmada: máximo 10 minutos por defecto; nunca se persiste como URL pública.

## Finanzas

- Cliente autenticado no escribe directamente tablas financieras.
- API valida token, membresía, acción, periodo e idempotencia.
- RPC transaccional realiza la escritura y auditoría.
- Un pago o gasto no se elimina: se reversa con motivo.
- Periodo cerrado bloquea cargos, pagos y gastos. Sólo Dirección puede reabrir y debe justificar.
- Cuotas/fondos son dinero de terceros; los honorarios de Emporio son otra entidad/movimiento.

## Base de datos

- RLS habilitada y forzada en tablas condominales.
- `authenticated` recibe sólo `SELECT` donde una política lo permita.
- No se conceden `INSERT/UPDATE/DELETE` directos a `anon` o `authenticated` en tablas financieras.
- Las funciones de seguridad son `SECURITY DEFINER`, fijan `search_path`, validan `auth.uid()` o un actor suministrado exclusivamente por servidor y revocan ejecución pública salvo la estrictamente necesaria.
- `service_role` sólo existe en rutas del servidor.

## Servidor

Orden obligatorio:

1. validar método y tamaño;
2. extraer bearer token;
3. resolver usuario con Supabase Auth;
4. validar perfil activo;
5. resolver membresía y acción;
6. validar esquema de entrada;
7. comprobar condominio/unidad;
8. comprobar periodo;
9. comprobar idempotencia;
10. ejecutar una RPC;
11. verificar respuesta completa;
12. registrar resultado;
13. devolver error genérico sin filtrar secretos.

## Interfaz

La interfaz refleja permisos para evitar confusión, pero no es control de seguridad:

- sólo lectura no ve botones de mutación;
- IDs no autorizados se tratan como no encontrados;
- los errores no se convierten en éxito;
- demo se identifica visualmente y utiliza proyecto/usuarios separados.
