/**
 * Whether the waiting-room sketchbook is busy: baking its page shots, riffling,
 * or turning a page. The tea room loads and renders in the gaps, so three.js
 * work never lands in the same frames as a page curl.
 */
export type BookWork = 'bake' | 'riffle' | 'turn';

// Baking until the sketchbook says otherwise, so nothing starts before it mounts.
const busy = new Set<BookWork>(['bake']);
let restingSince = 0;

/** A turn ends and the next riffle leaf starts within this; wait out the gap. */
export const BOOK_QUIET_MS = 450;

export function noteBook(work: BookWork, on: boolean) {
  if (on) busy.add(work);
  else if (busy.delete(work) && busy.size === 0)
    restingSince = performance.now();
}

/** The sketchbook left: nothing holds the room back any more. */
export function releaseBook() {
  busy.clear();
  restingSince = 0;
}

export function bookResting(quietMs = BOOK_QUIET_MS) {
  return busy.size === 0 && performance.now() - restingSince >= quietMs;
}

/** Resolves once the book has rested for a moment, or after `capMs` regardless. */
export function whenBookRests(capMs = 15000): Promise<void> {
  const start = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (bookResting() || performance.now() - start >= capMs) resolve();
      else window.setTimeout(check, 100);
    };
    check();
  });
}
