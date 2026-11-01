import { describe, expect, it } from 'vitest';
import { shelfLabel } from '../src/ui/shelfLabels';

describe('Shelf wallet labels', () => {
  it('shows only the referral nickname from a Nansen referral label', () => {
    expect(shelfLabel('Uses "SANTOCHAN" HL Referral Code', '0x1234')).toBe(
      'santochan',
    );
    expect(shelfLabel('Uses "THEDOCTOR" HL Referral Code B', '0x1234')).toBe(
      'thedoctor',
    );
  });

  it('shortens Hyperliquid whale labels and retains other Nansen labels', () => {
    expect(shelfLabel('HL Perps Whale', '0x1234')).toBe('Whale');
    expect(shelfLabel('Token Millionaire', '0x1234')).toBe('Token Millionaire');
  });

  it('omits a label when Nansen supplied only an address', () => {
    expect(shelfLabel('0x1234', '0x1234')).toBeNull();
    expect(shelfLabel('0x1234...abcd', '0x1234ffffabcd')).toBeNull();
    expect(shelfLabel('', '0x1234')).toBeNull();
    const solana = 'Gz3jNBsWMHNydXFRrJj3wzSCi22pLvL5TYpzwkGBKu6i';
    expect(shelfLabel('Gz3jNB...Ku6i', solana)).toBeNull();
  });
});
