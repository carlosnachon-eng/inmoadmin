// Sanitized observations from 2026-10-08, NOT raw provider payloads and NOT
// proof of identity. Display refs are not native IDs or dedupe keys.
// Local fixtures substitute synthetic IDs, preserving only equality relations.
export const realObservations = [
  { occurred: "2026-10-08T19:17:46Z", metaReceived: "2026-10-08T19:17:48.793940Z",
    respondReceived: "2026-10-08T19:17:49.444423Z", metaRef: "7f1ef7248ee0ee1a",
    metaMessageRef: "252dce6cbfcc1f4c", respondRef: "e883d66b5c6a4bef", respondMessageRef: "69101c1d3c5ee5e0",
    metaType: "message.received", respondType: "message.received", expectedReason: "temporal_only" },
  { occurred: "2026-10-08T19:17:55Z", metaReceived: "2026-10-08T19:17:57.033791Z",
    respondReceived: "2026-10-08T19:17:58.073469Z", metaRef: "83242fa03e1c0147",
    metaMessageRef: "a358588aa46723e2", originalRef: "252dce6cbfcc1f4c", respondRef: "20319a8fde403af8",
    respondMessageRef: "331dc4c360f42126", metaType: "message.revoke", respondType: "message.received",
    expectedReason: "semantic_conflict" },
  { occurred: "2026-10-08T19:18:03Z", metaReceived: "2026-10-08T19:18:04.879831Z",
    respondReceived: "2026-10-08T19:18:06.249726Z", metaRef: "f18ab5d301332f83",
    metaMessageRef: "e0c0b774839bbbc2", respondRef: "d7583b9521b8c10e", respondMessageRef: "f6eabd0ebd5fd633",
    metaType: "message.received", respondType: "message.received", expectedReason: "temporal_only" },
];
export const syntheticScope = { waba: "999000000000001", phone: "999000000000002", channel: "544519" };
export const syntheticNative = (suffix) => `wamid.SYNTHETIC_${suffix}`;
