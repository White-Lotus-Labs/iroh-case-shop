/** Process-local guard: one admitted turn may mutate a saved chat at a time. */
const activeChats = new Set<string>();

export function claimChatTurn(chatId: string): (() => void) | null {
  if (activeChats.has(chatId)) return null;
  activeChats.add(chatId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeChats.delete(chatId);
  };
}
