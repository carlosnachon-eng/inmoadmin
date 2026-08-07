# Evidencia Storage P0.5 — ambiente demo

Fecha: 17 de julio de 2026
Proyecto: `kmxzvcngfrzcasedtexw`

## Resultado

```text
12 pruebas
12 aprobadas
0 fallidas
```

La batería se ejecutó antes y después del rollback completo.

## Controles verificados

1. El bucket condominal es privado.
2. Un anónimo no descarga documentos.
3. A descarga documentos de A, pero no de B.
4. B descarga documentos de B, pero no de A.
5. La URL pública convencional no entrega bytes.
6. La URL firmada funciona durante su vigencia.
7. La firma realmente expira.
8. Se rechazan nombres con path traversal.
9. Se rechazan tipos ejecutables.
10. Todas las rutas físicas comienzan con el UUID del tenant.

Se comprobaron seis documentos seed y los documentos generados por recibos y
exportaciones. También se neutralizaron las dos referencias legadas a
`getPublicUrl` en la vista de detalle; el flujo activo usa metadatos privados y
URLs firmadas desde servidor.

Conclusión: no se encontró un mecanismo funcional de acceso público o
cross-tenant para los documentos condominales.
