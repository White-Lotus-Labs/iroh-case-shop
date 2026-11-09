import { Fragment, type CSSProperties } from 'react';
import type { Station } from '../shared/contracts';

export const STATION_TEASERS: Partial<
  Record<Station, { glyph: string; text: string; cta?: [string, string] }>
> = {
  Counter: {
    glyph: '签',
    text: 'Choose a thesis. See whether smart money supports it.',
    cta: ['Open the', 'Thesis Desk'],
  },
  AvatarSeat: {
    glyph: '师',
    text: 'Discover rare brews, inspect their treasures, and open a case.',
    cta: ['Explore the', 'Tea Collection'],
  },
  Shelf: {
    glyph: '卷',
    text: 'Browse your tea case activity and verified transaction receipts.',
    cta: ['Open the', 'Activity Ledger'],
  },
  TeaTable: {
    glyph: '星',
    text: 'Open the live planetary model in a new tab.',
    cta: ['Open the', 'planetary model'],
  },
};

/** Decorative ink-typed line. Always pair it with a readable copy for assistive tech. */
export function InkLine({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  let index = 0;
  return (
    <span className={`ink-line ${className}`} aria-hidden="true">
      {text.split(' ').map((word, w) => (
        <Fragment key={w}>
          {w > 0 && ' '}
          <span className="ink-word">
            {Array.from(word).map((char, c) => (
              <span key={c} style={{ '--i': index++ } as CSSProperties}>
                {char}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
