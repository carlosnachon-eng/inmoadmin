# Ensayo de rollback y reinstalación P0.5

Fecha: 17 de julio de 2026
Proyecto: `kmxzvcngfrzcasedtexw`

## Secuencia

1. Inventario lógico del demo.
2. Limpieza guardada de dos tenants ficticios y catorce usuarios ficticios.
3. Eliminación exclusiva del esquema `public` del proyecto demo.
4. Reinstalación desde cero de siete migraciones:
   - baseline exclusivo de demo;
   - seguridad P0;
   - grants demo;
   - alcance por tenant;
   - acceso de aplicación demo;
   - rol de sólo lectura demo;
   - corrección del digest para rate limit.
5. Recreación del seed A/B.
6. Repetición de RLS, Storage, recibos, exportación y build.

## Estado reconstruido

```text
2 condominios
72 unidades
14 usuarios ficticios
15 membresías totales
216 cuotas
205 pagos seed
4 gastos
```

Los identificadores y hashes de PDFs cambian por diseño; los conteos y reglas
estructurales se conservaron. La última reconstrucción aplicó las siete
migraciones finales desde una base vacía.

Conclusión: el demo puede destruirse y reconstruirse de forma reproducible sin
depender de producción.
