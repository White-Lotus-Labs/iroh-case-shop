export interface ShelfIdentity {
  name: string;
  portraitIndex: number;
}

export const SHELF_CAST_NAME = 'The Ten Spirits · Nansen leaderboard';
export const SHELF_GUEST_NAME = 'Wandering spirit';

const identities: readonly ShelfIdentity[] = [
  { name: 'Azure Dragon', portraitIndex: 0 },
  { name: 'Vermilion Phoenix', portraitIndex: 1 },
  { name: 'White Tiger', portraitIndex: 2 },
  { name: 'Black Tortoise', portraitIndex: 3 },
  { name: 'Qilin', portraitIndex: 4 },
  { name: 'Cloud Ox', portraitIndex: 5 },
  { name: 'Nine-Tail Fox', portraitIndex: 6 },
  { name: 'Red-Crowned Crane', portraitIndex: 7 },
  { name: 'Golden Koi', portraitIndex: 8 },
  { name: 'Jade Rabbit', portraitIndex: 9 },
];

export function shelfIdentityForRank(rank: number): ShelfIdentity | null {
  return Number.isInteger(rank) ? (identities[rank - 1] ?? null) : null;
}
