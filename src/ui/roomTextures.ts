import type { ThesisId } from '../thesis/types';

export const THESIS_IDS: readonly ThesisId[] = ['robinhood', 'bullrun', 'ai'];

/** Room textures the warm-up fetches while three.js loads (BackWall, ThesisCards). */
export function roomTextures(light: boolean) {
  const cover = light ? '360w' : '600w';
  return [
    '/images/tea-back-wall.bbdb12.webp',
    ...THESIS_IDS.map((id) => `/images/theses/${id}-${cover}.webp`),
  ];
}

/** HangingPaper's posters: they mount at Enter Teashop, so they preload once the room is ready. */
export const SHELF_POSTERS = [
  '/images/shelf/spirit-1.d17cfc.webp',
  '/images/shelf/spirit-2.db8327.webp',
  '/images/shelf/spirit-3.bd8816.webp',
];
