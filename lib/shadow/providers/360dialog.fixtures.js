const NOW_SECONDS = 1787119200; // 2026-08-19T06:00:00Z
const PHONE_NUMBER_ID = "fase2a-phone-id";
const CONTACT_ID = "5215500000101";

const inbound = ({ id, type = "text", content, timestamp = NOW_SECONDS }) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: "fase2a-waba-id",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "[TELEFONO]", phone_number_id: PHONE_NUMBER_ID },
        contacts: [{ wa_id: CONTACT_ID }],
        messages: [{ from: CONTACT_ID, id, timestamp: String(timestamp), type, [type]: content }],
      },
    }],
  }],
});

export const DIALOG360_FIXTURE_NOW = new Date(NOW_SECONDS * 1000);

export const DIALOG360_FIXTURES = Object.freeze({
  textInbound: inbound({ id: "wamid.fase2a.text", content: { body: "La llave de la propiedad necesita seguimiento" } }),
  appEcho: {
    object: "whatsapp_business_account",
    entry: [{
      id: "fase2a-waba-id",
      changes: [{
        field: "smb_message_echoes",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "[TELEFONO]", phone_number_id: PHONE_NUMBER_ID },
          message_echoes: [{ from: PHONE_NUMBER_ID, to: CONTACT_ID, id: "wamid.fase2a.echo", timestamp: String(NOW_SECONDS), type: "text", text: { body: "Ya revisamos tu solicitud" } }],
        },
      }],
    }],
  },
  image: inbound({ id: "wamid.fase2a.image", type: "image", content: { id: "media-image-fixture", mime_type: "image/jpeg", caption: "Fuga en cocina" } }),
  pdf: inbound({ id: "wamid.fase2a.pdf", type: "document", content: { id: "media-pdf-fixture", mime_type: "application/pdf", filename: "omitido.pdf" } }),
  audio: inbound({ id: "wamid.fase2a.audio", type: "audio", content: { id: "media-audio-fixture", mime_type: "audio/ogg" } }),
  duplicate: inbound({ id: "wamid.fase2a.text", content: { body: "La llave de la propiedad necesita seguimiento" } }),
  outOfOrder: inbound({ id: "wamid.fase2a.out-of-order", content: { body: "Seguimiento de mantenimiento" }, timestamp: NOW_SECONDS - 3600 }),
  status: {
    object: "whatsapp_business_account",
    entry: [{ id: "fase2a-waba-id", changes: [{ field: "messages", value: { statuses: [{ id: "wamid.fase2a.status", status: "delivered", timestamp: String(NOW_SECONDS) }] } }] }],
  },
  malformed: { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ type: "text" }] } }] }] },
  oversized: { object: "whatsapp_business_account", padding: "x".repeat(257 * 1024) },
  pii: inbound({ id: "wamid.fase2a.pii", content: { body: "Mi correo qa@example.invalid, teléfono +52 55 0000 0101, liga https://example.invalid/privado y cuenta 1234567890123456" } }),
  multiIntent: inbound({ id: "wamid.fase2a.multi", content: { body: "Mando comprobante de renta y el técnico nunca llegó" } }),
});
