# Evidencia de importación P0.5

Fecha: 17 de julio de 2026
Proyecto: `kmxzvcngfrzcasedtexw`

## Resultado

```text
13 escenarios
13 aprobados
0 fallidos
```

## Escenarios aprobados

- CSV válido con encabezados esperados.
- Comas, comillas, CRLF y BOM conforme a RFC 4180.
- Encabezados incorrectos.
- Unidades duplicadas.
- Correo inválido.
- Campo obligatorio ausente.
- Archivo con una fila inválida sin cambios parciales.
- Extensión no CSV.
- Interrupción simulada con rollback total.
- Reintento sin duplicación.
- Actualización de unidad existente sin borrar omisiones.
- Condominio B sin cambios durante una importación de A.
- Reutilización segura del resultado mediante idempotencia.

Conteos estructurales conservados:

```text
Condominio A: 60 unidades
Condominio B: 12 unidades
```

Conclusión: la importación es transaccional, no destructiva por omisión y no
cruza tenants.
