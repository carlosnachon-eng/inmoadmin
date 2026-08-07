# Guardas anti-producción — P0.5 condominios

Fecha: 17 de julio de 2026

## Identidades separadas

| Ambiente | Organización | Proyecto | Project Reference | URL |
|---|---|---|---|---|
| Producción (bloqueado) | Emporio Inmobiliario | `inmoadmin` | `bnzrnizrmonjxlktbhlp` | `https://bnzrnizrmonjxlktbhlp.supabase.co` |
| Demo permitido | Emporio Inmobiliario Demo (Free) | `inmoadmin-condominios-demo` | `kmxzvcngfrzcasedtexw` | `https://kmxzvcngfrzcasedtexw.supabase.co` |

No se imprimen ni documentan claves, contraseñas o cadenas de conexión.

## Archivo de entorno

- `.env.demo.local`: único archivo permitido para operaciones P0.5; está ignorado por Git y usa permisos `0600`.
- `.env.demo.example`: plantilla versionable sin secretos.
- `.env.local`: producción; ningún comando P0.5 lo carga.

## Guarda central

`scripts/lib/demo-environment-guard.mjs` se ejecuta antes de crear un cliente o conexión. Requiere simultáneamente:

1. `APP_ENV=demo`;
2. `SUPABASE_ENVIRONMENT=demo`;
3. confirmación exacta `I_ACKNOWLEDGE_DEMO_ONLY`;
4. nombre exacto del proyecto demo;
5. coincidencia URL ↔ Project Reference;
6. coincidencia conexión Postgres ↔ Project Reference;
7. allowlist con un solo Project Reference;
8. claves JWT con roles `anon` y `service_role` y `ref` demo;
9. ausencia del ref, URL y huella de credencial en blocklists productivas.

Si alguna condición falla, aborta antes de conectar con:

```text
OPERACIÓN CANCELADA: EL DESTINO NO ESTÁ CONFIRMADO COMO AMBIENTE DEMO.
```

No existe `--force`.

## Salida permitida

La guarda sólo muestra ambiente, nombre del proyecto, referencia, URL enmascarada, tipo de operación y confirmación de bloqueo. Nunca muestra claves, contraseña o conexión Postgres.
