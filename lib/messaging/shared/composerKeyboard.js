// Shared keyboard behavior for human-operated commercial chats.
// Enter submits; Shift+Enter leaves the native newline behavior intact.
// IME composition, modifier shortcuts and held-down keys must never dispatch.
export function shouldSendOnEnter(e){
 return e?.key==='Enter' && !e.shiftKey && !e.repeat && !e.isComposing &&
  !e.nativeEvent?.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey;
}
