# Pase correctivo mínimo P0/P0.5

Se corrigió la regresión que impedía registrar gastos porque
`guardarGasto` utilizaba una variable `documento` fuera de alcance. La carga
privada del comprobante quedó asociada exclusivamente al gasto, con validación
de tipo y límite de 10 MB tanto en cliente como en servidor. El formulario sólo
se limpia después de que la API confirma el registro.

La entrada `/` ahora consulta en servidor el perfil y las membresías reales:
conserva a usuarios internos en el sistema, redirige condóminos y propietarios
multiunidad a `/condomino`, y rechaza cuentas sin asignación. Los enlaces de
autenticación del portal usan el origen del ambiente activo.

Queda fuera de este pase el diseño comercial final del recibo: logotipo, datos
del emisor, desglose, jerarquía tipográfica y presentación institucional.
