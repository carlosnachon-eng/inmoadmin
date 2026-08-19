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
  inboundAdmin: messageEvent({ eventId: "evt-admin-in-1", messageId: "msg-admin-in-1", text: "Hay una fuga en la propiedad" }),
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
  duplicate: messageEvent({ eventId: "evt-admin-in-1", messageId: "msg-admin-in-1", text: "Hay una fuga en la propiedad" }),
  sameTextDifferentMessage: messageEvent({ eventId: "evt-admin-in-2", messageId: "msg-admin-in-2", timestamp: "2026-08-19T12:01:00.000Z", text: "Hay una fuga en la propiedad" }),
  pii: messageEvent({ eventId: "evt-pii", messageId: "msg-pii", text: "Escribe a persona@example.com, +52 222 123 4567 o https://privado.test/doc" }),
  attachment: messageEvent({ eventId: "evt-attachment", messageId: "msg-attachment", text: "Adjunto comprobante https://privado.test/file", message: { type: "image", url: "https://privado.test/file" } }),
  malformed: { event_type: "message.received", event_id: "evt-malformed", message: {} },
  multiIntent: messageEvent({ eventId: "evt-multi", messageId: "msg-multi", text: "Mando comprobante de renta y el técnico nunca llegó" }),
};
