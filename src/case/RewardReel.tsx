import type { CSSProperties } from 'react';

const glyphs = { USDI: '茶', SHITZU: '犬', RHEA: '芽', AURORA: '光' } as const;
export type RewardSymbol = keyof typeof glyphs;

export function TokenSeal({ symbol }: { symbol: RewardSymbol }) {
  return (
    <span className="tea-token-seal" data-token={symbol} aria-hidden="true">
      {glyphs[symbol]}
    </span>
  );
}

/** This component presents a result that was already read from finalized state. */
export function RewardReel({
  symbols,
  winner,
  tier,
}: {
  symbols: RewardSymbol[];
  winner: RewardSymbol;
  tier: string;
}) {
  const cards = [
    ...symbols,
    ...symbols,
    ...symbols,
    ...symbols,
    winner,
    ...symbols.slice(0, 2),
  ];
  const stop = symbols.length * 4;
  return (
    <div
      className="tea-reel"
      role="img"
      data-tier={tier}
      aria-label={`Reward reel landed on ${winner}`}
    >
      <div
        className="tea-reel-track"
        style={{ '--stop': stop } as CSSProperties}
        aria-hidden="true"
      >
        {cards.map((symbol, index) => (
          <div
            key={index}
            className="tea-reel-card"
            data-winner={index === stop ? symbol : undefined}
          >
            <TokenSeal symbol={symbol} />
            <span>{symbol}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
