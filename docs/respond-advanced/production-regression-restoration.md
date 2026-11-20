# Restauración del inventario y la trazabilidad

El deployment dpl_8SuyQ7Frmw7DK4PyjfH2z33WDW45 proviene de main f8d5af70246511bd1d9100a5c4af4200f1de86a0. Ese árbol carecía de pages/api/respond/inventory.js y sus cinco dependencias directas de lib/respond. Tampoco contenía los cambios de trazabilidad de citas en WorkCenterView y la ficha de cliente.

La versión certificada dpl_HZcedPHTsnkwjMkfPkVGmTBhKs3L se publicó por CLI desde una copia local con esos archivos. Un despliegue automático de main compila el contenido de Git y no incorpora archivos de una publicación CLI anterior. La corrección restaura esos archivos sobre f8d5af7 y mantiene las correcciones de registro público de propietarios y edición de marketing de los PR 271 y 272.

Se recupera también el uso de campos públicos de ubicación en salesInventory. No se incorpora la corrección geográfica experimental ni se cambia la selección de agentes.

Las migraciones 202611160001 y 202611160002 se incluyen como registro del esquema ya aplicado. No volver a ejecutarlas en Producción. La plataforma no debe aplicar automáticamente todas las migraciones históricas.

El candidato requiere RESPOND_INVENTORY_ENABLED=true en su entorno Production, además de las variables comerciales, CENTRAL_AUTH y la capacidad central existente. La capacidad y el bearer vigente se conservan. Publicar primero con --prod --skip-domain y comprobar el ID del deployment que sirve el dominio. La promoción requiere autorización posterior.

La reversión de aplicación es dpl_8SuyQ7Frmw7DK4PyjfH2z33WDW45. Ese deployment conserva los módulos recientes pero carece del endpoint comercial. Revertir no revierte el esquema de Supabase.
