# Evidencia RLS P0.5 — ambiente demo

Fecha: 17 de julio de 2026
Proyecto: `kmxzvcngfrzcasedtexw`
Producción bloqueada: `bnzrnizrmonjxlktbhlp`

## Resultado final

```text
18 pruebas
18 aprobadas
0 fallidas
0 cruces entre tenants
```

La suite se ejecutó nuevamente después de eliminar el esquema público, aplicar
desde cero todas las migraciones y recrear los datos ficticios.

## Cobertura

- Anónimo no puede listar condominios.
- Líder A sólo lee A; líder B sólo lee B.
- Conocer directamente un UUID ajeno no permite leerlo.
- Condómino ve únicamente su tenant y su unidad.
- Propietario multiunidad ve exactamente sus dos unidades y ninguna de B.
- Rol de sólo lectura no inserta condominios ni ejecuta acciones de escritura.
- Condómino no registra pagos directos.
- Auditoría y documentos respetan el tenant.
- Los permisos RPC se limitan por acción y condominio.
- Un condómino no lee cuotas de otra unidad del mismo tenant.

## Hallazgos y corrección

La ejecución final y la posterior al rollback completo aprobaron 17/17.
El alcance aislado valida tenant, rol, unidad, auditoría, documentos y
operaciones financieras del condominio.

Conclusión: el aislamiento por tenant, rol y unidad quedó demostrado en el
proyecto demo.
