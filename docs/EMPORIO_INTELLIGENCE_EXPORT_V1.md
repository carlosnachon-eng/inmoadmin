# Inmoadmin → Emporio Intelligence Export V1

Estado: preparado localmente; **no desplegado**, sin job, cron ni credencial nueva.

## Fuente y autorización

El código auditado en la rama `codex/veracruz-fase2-dev` identifica el inventario en `public.propiedades`. El export usa sólo una proyección explícita, definida en `lib/emporioIntelligenceExport.mjs`:

| Contrato | Columna Inmoadmin | Regla |
|---|---|---|
| `source_listing_id` | `id` | `inmoadmin:<uuid>`; estable aunque cambie `public_id`. |
| `operation` | `operacion` | `sale/venta → SALE`; `rent/rental/renta/arrendamiento → RENT`; otros fallan cerrado. |
| `status` | `status` | sólo `published → ACTIVE`; cualquier otro estado → `INACTIVE`. Nunca se exporta una venta inferida. |
| `property_type` | `tipo` | normalización cerrada; ausencia → `OTHER`. |
| `asking_price`, `currency` | `precio`, `moneda` | sólo MXN; precio inválido o ausente falla cerrado. |
| `state`, `city` | `estado`, `ciudad` | obligatorios. |
| `municipality` | `ciudad` | sustitución provisional documentada: no hay columna `municipio` auditada. |
| `zone` | `colonia` | la única granularidad de zona auditada; puede ser nula. |
| `address` | `direccion` | sólo se incluye con `mostrar_ubicacion_exacta=true`. |
| superficies/características | `m2_terreno`, `m2_construccion`, `recamaras`, `banos`, `estacionamientos` | opcionales, numéricos no negativos. |
| timestamps | `created_at`, `updated_at` | UTC normalizado. `created_at` se conserva como timestamp del registro, no como prueba de publicación pública. |
| `canonical_url` | `public_id` | URL pública opcional; no condiciona el id estable. |
| `title` | `titulo` | opcional. |

Campos expresamente excluidos: `notas_internas`, `agente_id`, fotos, amenidades, geocoordenadas, claves, usuarios, propietarios, prospectos, teléfonos, correos, contratos, pagos y documentos.

### Estados auditados

El UI de `propiedades-admin` enumera `published`, `reserved`, `sold`, `leased`, `draft` y `archived`. El fixture SQL de desarrollo añade `apartada`; el schema versionado no impone un `CHECK` para esta columna, por lo que también se trata `NULL` o cualquier futuro estado desconocido de forma conservadora.

| `propiedades.status` | Export V1 | Interpretación |
|---|---|---|
| `published` | `ACTIVE` | única condición que el sistema trata como publicable/compartible. |
| `reserved`, `apartada` | `INACTIVE` | no se ofrece como inventario activo; no se afirma venta. |
| `sold`, `leased` | `INACTIVE` | cerrado para disponibilidad; el export no incluye transacción confirmada. |
| `draft`, `archived`, `NULL`, desconocido | `INACTIVE` | fail-safe de disponibilidad. |

No hay dump ni acceso read-only a Producción en este cambio, por lo que estos son estados **versionados/auditados en la rama**, no un conteo de valores productivos. La primera prueba controlada deberá registrar el `distinct status` resultante y abortar si aparece un estado inesperado que requiera decisión de negocio.

### Puebla, Veracruz y geografía

La forma versionada de `public.propiedades` tiene `estado`, `ciudad` y `colonia`; no presenta `municipio` ni `zona` normalizados. El formulario permite texto libre para los tres, con defaults `Puebla` / `Puebla`, y los fixtures incluyen `Puebla`, `San Andres Cholula`, `San Pedro Cholula`, `Centro`, `Zerezotla` y `La Carcana`. No hay fixture Veracruz ni evidencia local suficiente para enumerar valores reales de Veracruz.

Por eso V1 conserva el texto fuente y usa provisionalmente `municipality=ciudad`, `zone=colonia`. Un `estado` o `ciudad` nulo hace fallar el export completo; `colonia` puede ser nula y se conserva como `zone:null`. Inconsistencias ortográficas (por ejemplo, acentos o variantes de municipio) no se corrigen silenciosamente: Emporio Intelligence las normalizará como una capa posterior trazable.

## Mecanismo preparado

`GET /api/admin/emporio-intelligence-export` es un descargable manual, no un endpoint de sincronización automática. Antes de tocar inventario:

1. exige un Bearer token de Supabase válido;
2. verifica perfil activo con `role_id=admin`;
3. consulta la única proyección permitida de `propiedades`, sin `select('*')`;
4. construye y valida el JSON en memoria;
5. lo devuelve como adjunto con `Cache-Control: private, no-store`.

No tiene escritura, scheduler, cron, LaunchAgent ni secreto en el código. La `SUPABASE_SERVICE_ROLE_KEY`, ya existente en el backend, nunca sale al cliente y sólo se usa después de autenticar al administrador. El endpoint todavía no está desplegado.

La consulta es sin filtros sobre el inventario autorizado, por lo que el export se marca `authoritative_full_snapshot=true`. Si en una futura implementación se filtra por plaza, rol o subconjunto, debe cambiar a `false`; Emporio Intelligence no debe interpretar ausencias como venta.

## Ejemplo sintético

```json
{
  "source_id": "inmoadmin-emporio",
  "authorized": true,
  "authoritative_full_snapshot": true,
  "observed_at": "2026-09-08T15:00:00.000Z",
  "listings": [{
    "source_listing_id": "inmoadmin:cb14b6c2-603d-49aa-b671-57f640c543ad",
    "operation": "SALE",
    "status": "ACTIVE",
    "property_type": "HOUSE",
    "asking_price": 3100000,
    "currency": "MXN",
    "state": "Puebla",
    "municipality": "Puebla",
    "city": "Puebla",
    "zone": "La Paz",
    "address": null,
    "land_m2": 120,
    "built_m2": 180,
    "bedrooms": 3,
    "bathrooms": 2.5,
    "parking_spaces": 2,
    "published_at": "2026-09-08T12:00:00.000Z",
    "updated_at": "2026-09-08T13:00:00.000Z",
    "canonical_url": "https://www.emporioinmobiliario.com.mx/propiedades/EMP-PUE-001",
    "title": "Casa de prueba en La Paz"
  }]
}
```

## Prueba y rollback futuros

Cuando se autorice una prueba en un entorno no productivo, un administrador podrá descargar el adjunto, validar el schema con Emporio Intelligence y destruir el archivo de prueba. El rollback de código consiste en retirar `pages/api/admin/emporio-intelligence-export.js`; no hay migración, estado remoto ni dato comercial escrito por este cambio.
