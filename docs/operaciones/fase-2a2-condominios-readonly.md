# Fase 2A.2-A — Condominios read-only

El Centro Operativo consume únicamente `condominios`,
`unidades_condominio` y `cuotas_condominio`. No consulta datos de identidad del
condómino ni expone la URL de comprobantes. `gastos_condominio` queda fuera del
alcance porque no representa un pendiente operativo estructurado.

## Deuda P0 separada

El hardening de las tablas productivas de Condominios no forma parte de esta
ampliación read-only. Antes de ampliar sus mutaciones debe resolverse en un
corte independiente:

- RLS está deshabilitado en `condominios`, `unidades_condominio`,
  `cuotas_condominio` y `gastos_condominio`;
- `anon` y `authenticated` conservan DML amplio sobre esas tablas;
- `/condominio/[id]` comprueba sesión, pero no aplica el permiso específico
  `condominios` antes de leer o modificar datos.

El endurecimiento deberá coordinar las políticas del portal del condómino, el
módulo interno y sus escrituras actuales. No debe resolverse revocando permisos
productivos de forma aislada.
