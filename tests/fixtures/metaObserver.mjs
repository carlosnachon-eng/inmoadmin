// SYNTHETIC values in the official Meta wire shapes. Not captured production
// traffic, not a test of Meta delivery/subscription. Sources and gaps: docs/meta-admin-observer.md.
export const scope = { wabaId: "900000000000001", phoneNumberId: "900000000000002" };
export const syntheticEnv = { META_ADMIN_OBSERVER_ENABLED: "true",
  META_ADMIN_WABA_ID: scope.wabaId, META_ADMIN_PHONE_NUMBER_ID: scope.phoneNumberId,
  META_OBSERVER_APP_SECRET: "synthetic_local_app_secret_not_valid_remotely",
  META_OBSERVER_VERIFY_TOKEN: "synthetic_local_verify_token_not_valid_remotely" };
export const inbound = (id = "wamid.SYNTHETIC_INBOUND") => ({ from: "15555550101", id,
  timestamp: "1791471837", type: "text", text: { body: "Mensaje sintético de observación" } });
export const status = (state = "sent", id = "wamid.SYNTHETIC_OUTBOUND") => ({ id,
  status: state, timestamp: "1791471838", recipient_id: "15555550101",
  ...(state === "failed" ? { errors: [{ code: 131049, title: "Synthetic failure", message: "Not persisted" }] } : {}) });
export const echo = (id = "wamid.SYNTHETIC_APP") => ({ ...inbound(id), from: "15555550202", to: "15555550101" });
export const change = (data = { messages: [inbound()] }, field = "messages") => ({ field,
  value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15555550202",
    phone_number_id: scope.phoneNumberId }, ...data } });
export const payload = (...changes) => ({ object: "whatsapp_business_account",
  entry: [{ id: scope.wabaId, changes: changes.length ? changes : [change()] }] });
export const fixtures = {
  inbound: payload(),
  media: payload(change({ messages: [{ ...inbound("wamid.SYNTHETIC_MEDIA"), type: "image",
    text: undefined, image: { id: "900000000000003", mime_type: "image/jpeg", sha256: "synthetic", caption: "private" } }] })),
  statuses: payload(change({ statuses: [status("read"), status("sent"), status("delivered"), status("failed")] })),
  appEcho: payload(change({ message_echoes: [echo()] }, "smb_message_echoes")),
  edit: payload(change({ message_echoes: [{ ...echo("wamid.SYNTHETIC_EDIT"), type: "edit", text: undefined,
    edit: { original_message_id: "wamid.SYNTHETIC_APP", message: { type: "text", text: { body: "Synthetic edit" } } } }] }, "smb_message_echoes")),
  revoke: payload(change({ message_echoes: [{ ...echo("wamid.SYNTHETIC_REVOKE"), type: "revoke", text: undefined,
    revoke: { original_message_id: "wamid.SYNTHETIC_APP" } }] }, "smb_message_echoes")),
};
