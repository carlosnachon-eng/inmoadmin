# Ambientes, despliegue y recuperación

Estado documentado: 25 de junio de 2026.

## Matriz de ambientes

| Ambiente | Aplicación | Base de datos | Despliegue |
|---|---|---|---|
| Local | `http://localhost:3000` | Proyecto definido por `.env.local` | `npm run dev` o equivalente |
| Preview | URL temporal de Vercel | Debe definirse explícitamente en Vercel | Commit o pull request |
| Producción | `https://app.emporioinmobiliario.com.mx` | Proyecto productivo de Supabase | Push/despliegue de `main` |

El repositorio no contiene un archivo `.vercel/project.json`, por lo que el
nombre o ID interno del proyecto Vercel no se considera configuración
portable. La relación repositorio–producción se confirmó mediante los
despliegues públicos de GitHub y la respuesta Vercel del dominio productivo.

## Variables requeridas

La lista canónica para desarrollo se encuentra en `.env.example`.

### Públicas

Estas variables pueden llegar al navegador:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

Que una variable sea pública no elimina la necesidad de restringirla en el
proveedor y proteger los datos con RLS.

### Exclusivas del servidor

Nunca deben usar el prefijo `NEXT_PUBLIC_` ni incluirse en commits, capturas,
logs o respuestas de API:

- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `ANTHROPIC_API_KEY`
- `DIDIT_API_KEY`
- `EASYBROKER_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT`
- `RESPOND_IO_TOKEN`

## Configuración local

1. Usar una versión de Node compatible con Next.js 14.1. La versión exacta
   quedará fijada cuando se cree el lockfile y se valide el build.
2. Copiar `.env.example` como `.env.local`.
3. Completar valores mediante el gestor autorizado; nunca copiarlos a
   documentación.
4. Instalar dependencias.
5. Ejecutar `npm run dev`.
6. Validar autenticación y una consulta de lectura antes de trabajar con BI.

El repositorio no incluye actualmente lockfile. Hasta corregirlo, no debe
asumirse que dos instalaciones limpias producirán exactamente el mismo árbol
de dependencias.

## Configuración Vercel

Las variables deben configurarse por ambiente:

- Development para ejecución vinculada a Vercel.
- Preview para ramas y pull requests.
- Production exclusivamente para `main`.

Reglas:

1. Las previews no deben usar service role productivo salvo autorización
   explícita.
2. Las previews que apunten a producción deben ser únicamente de lectura y
   estar protegidas.
3. Los Cron Jobs solo deben operar en producción.
4. `CRON_SECRET` debe coincidir con el mecanismo de autorización de Vercel.
5. Cambiar variables requiere un nuevo despliegue para garantizar que las
   funciones utilicen la configuración actual.

## Flujo de despliegue actual

```text
Cambio local
  → commit
  → push a GitHub
  → Vercel construye el commit
  → Preview o Production según rama/contexto
  → validación funcional
```

La evidencia observada indica que los commits de `main` generan despliegues de
producción. Antes de cada push se deberá revisar:

- `git status`;
- diff completo;
- build de producción;
- variables requeridas;
- impacto sobre rutas API y Cron.

V0-01 no realiza push ni despliegue.

## Proceso de migraciones desde V0-02

El repositorio todavía no tiene migraciones versionadas. A partir de V0-02:

1. Toda modificación de esquema deberá existir como archivo SQL versionado.
2. Las migraciones deberán ser aditivas siempre que sea posible.
3. Cada migración incluirá precondiciones y validaciones posteriores.
4. No se eliminarán columnas o tablas en la misma entrega que introduce su
   sustitución.
5. El SQL se validará primero en un ambiente no productivo.
6. Se registrará la fecha, responsable y resultado de ejecución.
7. No se modificarán datos operativos mediante una migración BI sin
   autorización específica.

## Recuperación y rollback

### Aplicación

1. Identificar el último despliegue estable de Vercel.
2. Promover o redeplegar ese commit.
3. Ejecutar pruebas de humo.
4. Registrar el incidente y el commit afectado.

### Base de datos

Las migraciones de BI priorizarán cambios reversibles y aditivos. El rollback
no debe consistir en borrar información automáticamente.

Antes de ejecutar una migración productiva:

1. confirmar respaldo o capacidad de recuperación de Supabase;
2. guardar consultas de validación;
3. preparar, cuando aplique, SQL de reversión;
4. verificar que la versión anterior de la aplicación siga funcionando con el
   esquema nuevo;
5. detener el despliegue si esa compatibilidad no existe.

Cuando una reversión destructiva represente más riesgo que mantener el cambio,
se desactivará la funcionalidad por configuración y se realizará una
corrección hacia delante.

## Validación mínima por ambiente

### Local

- Aplicación inicia.
- Login funciona.
- No aparecen variables secretas en el cliente.
- La ruta trabajada responde con datos de prueba o lectura autorizada.

### Preview

- Build exitoso.
- Autenticación y permisos.
- Prueba de navegación de módulos críticos.
- APIs nuevas rechazan usuarios no autorizados.
- Ningún Cron se ejecuta accidentalmente.

### Producción

- HTTP 200 en la portada.
- Inicio de sesión.
- Navegación principal.
- Lectura de un módulo crítico.
- Verificación de logs y errores.
- Confirmación de que los Cron siguen protegidos.

## Responsabilidades

| Área | Responsabilidad |
|---|---|
| Desarrollo | Código, migraciones, pruebas, documentación y rollback |
| Dirección/Administración | Validar definiciones y conciliaciones |
| Responsable Supabase | Ejecutar o aprobar cambios de esquema y RLS |
| Responsable Vercel | Variables, dominios, despliegues y Cron |

Los nombres de responsables se definirán fuera del repositorio o en una
documentación operativa autorizada; no deben inferirse desde correos
hardcodeados.

