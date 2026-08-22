const ADMIN_CHANNEL_ID = "respond-admin-channel-fixture";
const SALES_CHANNEL_ID = "respond-sales-channel-fixture";
const BASE_TIME = "2026-08-19T12:00:00.000Z";

const messageEvent = ({
  eventType = "message.received",
  eventId,
  messageId,
  channelId = ADMIN_CHANNEL_ID,
  text,
  timestamp = BASE_TIME,
  message = {},
}) => ({
  event_type: eventType,
  event_id: eventId,
  timestamp,
  contact: { id: "contact-fixture" },
  conversation: { id: "conversation-fixture", channelId },
  message: { messageId, channelId, timestamp, text, ...message },
});

export const RESPOND_ADMIN_FIXTURE_CHANNELS = { admin: ADMIN_CHANNEL_ID, sales: SALES_CHANNEL_ID };

export const RESPOND_ADMIN_FIXTURES = {
  inboundAdmin: messageEvent({ eventId: "evt-admin-in-1", messageId: "msg-admin-in-1", text: "Hay una fuga en FASE2A-QA Casa Nube" }),
  inboundSales: messageEvent({ eventId: "evt-sales-in-1", messageId: "msg-sales-in-1", channelId: SALES_CHANNEL_ID, text: "Busco una casa" }),
  outboundAdmin: messageEvent({ eventType: "message.sent", eventId: "evt-admin-out-1", messageId: "msg-admin-out-1", text: "Ya revisamos tu solicitud", message: { sender: { source: "user" } } }),
  outboundSales: messageEvent({ eventType: "message.sent", eventId: "evt-sales-out-1", messageId: "msg-sales-out-1", channelId: SALES_CHANNEL_ID, text: "Te envío opciones", message: { sender: { source: "user" } } }),
  missingChannel: (() => {
    const payload = messageEvent({ eventId: "evt-no-channel", messageId: "msg-no-channel", text: "Sin canal" });
    delete payload.message.channelId;
    delete payload.conversation.channelId;
    return payload;
  })(),
  unknownChannel: messageEvent({ eventId: "evt-unknown-channel", messageId: "msg-unknown-channel", channelId: "unknown-fixture", text: "Canal desconocido" }),
  duplicate: messageEvent({ eventId: "evt-admin-in-1", messageId: "msg-admin-in-1", text: "Hay una fuga en FASE2A-QA Casa Nube" }),
  sameTextDifferentMessage: messageEvent({ eventId: "evt-admin-in-2", messageId: "msg-admin-in-2", timestamp: "2026-08-19T12:01:00.000Z", text: "Hay una fuga en FASE2A-QA Casa Nube" }),
  pii: messageEvent({ eventId: "evt-pii", messageId: "msg-pii", text: "Escribe a persona@example.com, +52 222 123 4567 o https://privado.test/doc" }),
  attachment: messageEvent({ eventId: "evt-attachment", messageId: "msg-attachment", text: "Adjunto comprobante https://privado.test/file", message: { type: "image", url: "https://privado.test/file" } }),
  imageNoText: messageEvent({ eventId: "evt-image", messageId: "msg-image", text: "", message: { type: "image", mimeType: "image/jpeg", fileName: "persona@example.com", size: 1200, id: "opaque-image", url: "https://private.test/image" } }),
  pdfNoText: messageEvent({ eventId: "evt-pdf", messageId: "msg-pdf", text: "", message: { type: "document", mimeType: "application/pdf", fileName: "contrato.pdf", size: 2400, id: "opaque-pdf" } }),
  audioNoText: messageEvent({ eventId: "evt-audio", messageId: "msg-audio", text: "", message: { type: "audio", mimeType: "audio/ogg", id: "opaque-audio" } }),
  videoNoText: messageEvent({ eventId: "evt-video", messageId: "msg-video", text: "", message: { type: "video", mimeType: "video/mp4", id: "opaque-video" } }),
  stickerNoText: messageEvent({ eventId: "evt-sticker", messageId: "msg-sticker", text: "", message: { type: "sticker", mimeType: "image/webp", id: "opaque-sticker" } }),
  locationNoText: messageEvent({ eventId: "evt-location", messageId: "msg-location", text: "", message: { type: "location", id: "opaque-location", latitude: 1, longitude: 2 } }),
  contactNoText: messageEvent({ eventId: "evt-contact", messageId: "msg-contact", text: "", message: { type: "contact", id: "opaque-contact", phone: "+52 222 123 4567" } }),
  unknownMediaNoText: messageEvent({ eventId: "evt-file", messageId: "msg-file", text: "", message: { attachments: [{ id: "opaque-file", mimeType: "application/octet-stream", url: "https://private.test/file" }] } }),
  textWithImage: messageEvent({ eventId: "evt-text-image", messageId: "msg-text-image", text: "Te mando el comprobante", message: { type: "image", caption: "Referencia +52 222 123 4567", id: "opaque-text-image" } }),
  emptyNoMedia: messageEvent({ eventId: "evt-empty", messageId: "msg-empty", text: "" }),
  unsupportedMedia: messageEvent({ eventId: "evt-unsupported", messageId: "msg-unsupported", text: "", message: { type: "interactive_product" } }),
  salesImage: messageEvent({ eventId: "evt-sales-image", messageId: "msg-sales-image", channelId: SALES_CHANNEL_ID, text: "", message: { type: "image", id: "opaque-sales-image" } }),
  malformed: { event_type: "message.received", event_id: "evt-malformed", message: {} },
  multiIntent: messageEvent({ eventId: "evt-multi", messageId: "msg-multi", text: "Mando comprobante de renta y el técnico nunca llegó" }),
};
