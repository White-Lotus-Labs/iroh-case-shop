import { describe, expect, it } from 'vitest';
import {
  SHELF_CAST_NAME,
  shelfIdentityForRank,
} from '../src/ui/shelfIdentities';

describe('Shelf spirit identities', () => {
  it('maps ranked wallet positions to the original spirit cast', () => {
    expect(
      Array.from(
        { length: 10 },
        (_, index) => shelfIdentityForRank(index + 1)?.name,
      ),
    ).toEqual([
      'Azure Dragon',
      'Vermilion Phoenix',
      'White Tiger',
      'Black Tortoise',
      'Qilin',
      'Cloud Ox',
      'Nine-Tail Fox',
      'Red-Crowned Crane',
      'Golden Koi',
      'Jade Rabbit',
    ]);
    expect(shelfIdentityForRank(1)?.portraitIndex).toBe(0);
    expect(shelfIdentityForRank(10)?.portraitIndex).toBe(9);
    expect(shelfIdentityForRank(11)).toBeNull();
    expect(shelfIdentityForRank(1.5)).toBeNull();
  });

  it('keeps the cast free of borrowed names', () => {
    const names = [
      SHELF_CAST_NAME,
      ...Array.from(
        { length: 10 },
        (_, index) => shelfIdentityForRank(index + 1)!.name,
      ),
    ].join(' ');
    expect(names).not.toMatch(/Iroh|Lotus|Bumi|Pakku|Roku|Avatar/i);
  });
});
