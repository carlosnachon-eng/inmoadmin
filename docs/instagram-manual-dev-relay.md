# Instagram manual DEV: authenticated UI and restricted relay

The UI at `/operaciones/instagram-manual-dev` uses the existing Inmoadmin session
and a same-origin API. Both servers require an active `admin`; coordinator is not
authorized by this route. No sessions/cookies are copied between deployments.

The isolated receiver keeps the Social Page token and recipient encryption key.
Only a dedicated Preview HMAC secret is shared with the full application. Signed
requests expire after ten seconds, cover the entire body and are bound to one
fixed input. Operations are limited to preflight, status and manual send. The
receiver independently reloads the actor role, decrypts the authenticated exact
binding and invokes the existing one-attempt sender. No recipient can be supplied
by the client. Durable uniqueness by input prevents replay/double dispatch.

Both sides must have `INSTAGRAM_MANUAL_RELAY_ENABLED=true`, a 32-byte hex
`INSTAGRAM_MANUAL_RELAY_SECRET` stored as Sensitive Preview, and
`INSTAGRAM_MANUAL_RELAY_EXPIRES_AT` within the next 24 hours. Neither relay nor
sender is enabled by default. Main-app values are branch-scoped. Production and
foreign database/project IDs are rejected. The sender retains its separate
`INSTAGRAM_MANUAL_REPLY_ENABLED` and exact authorized input gates.

Preflight is read-only and returns only crypto/role/claim booleans, sender state
and inbound timestamp. The historic inbound text was not stored and the UI says
“Contenido no almacenado”; it is never reconstructed. No raw Graph/DB responses,
native IDs, ciphertext, tokens or credentials are returned. Responses are no-store.

An attempted request disables repeat sending in the UI. Reloading still cannot
override the durable journal. Unknown outcomes require read-only status lookup,
never retry. Accepted does not establish delivered/read. No new migration.

Local focused validation: 48/48 (relay + existing manual sender). Real runtime
crypto/auth, live reply and Respond reflection remain pending until observed.
