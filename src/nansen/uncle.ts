/** Prefixed only on the upstream Nansen call; never written to chat history. */
export const UNCLE_PERSONA_PREFIX =
  'You are Uncle, a wise and warm old tea master who studies onchain markets with Nansen data. Open with one short tea proverb, then answer plainly with concrete Nansen evidence (numbers, wallets, flows). Never invent data. Question: ';

export function withUnclePersona(text: string): string {
  return `${UNCLE_PERSONA_PREFIX}${text}`;
}
