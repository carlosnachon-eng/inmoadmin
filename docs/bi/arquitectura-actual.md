# Arquitectura actual de InmoAdmin

Estado documentado: 25 de junio de 2026.

Este documento describe el sistema existente antes de introducir la capa de
Business Intelligence. No define todavía métricas, vistas financieras ni
migraciones de V0.

## Repositorio

| Elemento | Valor confirmado |
|---|---|
| Repositorio local | `/Users/carlos/Documents/GitHub/inmoadmin` |
| Repositorio remoto | `https://github.com/carlosnachon-eng/inmoadmin.git` |
| Rama productiva observada | `main` |
| Commit auditado | `290e96f17af7f1721421f35acbe63ed26d1b51f2` |
| Mensaje del commit | `Add project statistics dashboard` |
| Estado al iniciar V0-01 | Árbol de trabajo limpio |

GitHub registra despliegues de producción asociados a commits de `main`. El
commit auditado aparece como despliegue de producción el 25 de junio de 2026.

## Plataforma

- Next.js 14.1 con Pages Router.
- React 18.
- JavaScript; no existe configuración TypeScript.
- Supabase JS 2.x para autenticación, base de datos y almacenamiento.
- Rutas serverless bajo `pages/api`.
- Vercel como plataforma de despliegue.
- Vercel Cron configurado en `vercel.json`.

Inventario aproximado del código:

| Tipo | Cantidad |
|---|---:|
| Archivos JavaScript bajo `pages` | 77 |
| Rutas API | 30 |
| Componentes | 16 |
| Librerías internas | 19 |
| Scripts auxiliares | 3 |

## Estructura

```text
components/       Componentes compartidos y componentes de Póliza
lib/              Cliente Supabase, permisos y utilidades de negocio
pages/            Pantallas y portales del Pages Router
pages/api/        Funciones serverless e integraciones
public/           Activos públicos
scripts/          Generadores PDF auxiliares en Python
vercel.json       Programación de tareas Cron
```

No existían al comenzar V0-01:

- directorio versionado de migraciones Supabase;
- pruebas automatizadas;
- scripts `test` o `lint`;
- pipeline CI versionado;
- lockfile del gestor de paquetes;
- versión de Node declarada;
- enlace local `.vercel/project.json`;
- documentación de ambientes.

Estos hallazgos se registran para tareas posteriores. V0-01 no cambia el
runtime ni instala dependencias.

## Flujo de aplicación

```text
Navegador
  ├─ páginas Next.js
  ├─ cliente Supabase público
  └─ rutas /api
       ├─ Supabase con service role en operaciones de servidor
       ├─ Resend
       ├─ Google APIs
       ├─ EasyBroker
       ├─ Respond.io
       ├─ Didit
       └─ Anthropic en módulos existentes
```

Una parte importante de las pantallas consulta Supabase directamente con la
clave pública. La seguridad efectiva de esas consultas depende de las
políticas RLS de Supabase. Algunas rutas API utilizan
`SUPABASE_SERVICE_ROLE_KEY`; esta variable debe permanecer exclusivamente en
el servidor.

## Autenticación y autorización

- La sesión se gestiona mediante Supabase Auth.
- `lib/permisos.js` consulta `profiles`, `roles` y `permisos_modulo`.
- Los administradores reciben acceso completo desde el helper de permisos.
- Algunas pantallas antiguas todavía implementan controles particulares.
- La futura API del Centro de Inteligencia deberá validar permisos en el
  servidor y no depender únicamente de ocultar elementos en la interfaz.

## Base de datos

Supabase es la fuente operativa principal. El esquema real y sus políticas RLS
se auditarán en V0-02. En V0-01 únicamente se confirmó la configuración por
variables de ambiente; no se extrajo ni modificó el esquema.

El cliente compartido se encuentra en `lib/supabase.js` y utiliza:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Varias rutas API crean clientes privilegiados con:

- `SUPABASE_SERVICE_ROLE_KEY`

## Integraciones externas detectadas

| Integración | Uso observado | Configuración |
|---|---|---|
| Supabase | Auth, base de datos y archivos | Variables Supabase |
| Resend | Correos transaccionales y recordatorios | `RESEND_API_KEY` |
| Google APIs | Envío de solicitudes a Sheets | `GOOGLE_SERVICE_ACCOUNT` |
| Google Maps | Geolocalización en cliente | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` |
| EasyBroker | Propiedades y contactos | `EASYBROKER_API_KEY` |
| Respond.io | Conversaciones y leads | `RESPOND_IO_TOKEN` |
| Didit | Validación de identidad/CURP | `DIDIT_API_KEY` |
| Anthropic | Análisis existentes y prioridades | `ANTHROPIC_API_KEY` |
| QuickChart | Generación de códigos QR | URL pública |

Las integraciones detectadas no pasan automáticamente a formar parte del
Centro de Inteligencia. Su incorporación seguirá el roadmap aprobado.

## Tareas programadas

`vercel.json` contiene cinco tareas:

| Ruta | Expresión UTC |
|---|---|
| `/api/cron-recordatorios` | `0 14 * * *` |
| `/api/cron-vencimientos-recibos` | `0 8 * * *` |
| `/api/reporte-semanal` | `0 8 * * 1` |
| `/api/cron-recordatorio-kpis` | `0 2 * * *` |
| `/api/cron-checador` | `0 14 * * 1-6` |

Las cinco rutas comprueban `CRON_SECRET`. Vercel interpreta las expresiones en
UTC. Cualquier calendario del Centro de Inteligencia deberá convertir las
fechas de presentación a `America/Mexico_City`.

## Producción observada

- Dominio: `https://app.emporioinmobiliario.com.mx`
- Plataforma confirmada por encabezados HTTP: Vercel.
- Respuesta observada durante V0-01: HTTP 200.
- GitHub registra un despliegue `Production` para el commit auditado.

El identificador interno del proyecto Vercel no está versionado en el
repositorio. Debe administrarse desde el equipo autorizado de Vercel y no
mediante un archivo `.vercel` compartido.

## Riesgos actuales relevantes para V0

1. No existe lockfile, por lo que una instalación futura podría resolver
   versiones transitivas distintas.
2. No se declara versión de Node.
3. No existen pruebas ni lint versionados.
4. No hay migraciones Supabase reproducibles todavía.
5. El acceso directo desde cliente hace indispensable auditar RLS.
6. Existen rutas con service role; cualquier API nueva debe validar sesión y
   permiso antes de leer datos.
7. Hay URLs productivas escritas directamente en distintos módulos.
8. Las tareas Cron operan en UTC mientras la operación usa horario de México.

Ninguno de estos riesgos fue corregido funcionalmente durante V0-01, salvo la
protección preventiva de secretos mediante `.gitignore` y `.env.example`.

