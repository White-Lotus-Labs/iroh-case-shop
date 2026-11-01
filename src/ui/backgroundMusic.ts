export const BACKGROUND_MUSIC_KEY = 'iroh-background-music';

// A 36 s mono loop with its seam crossfaded, smallest first.
export const BACKGROUND_MUSIC = [
  { src: '/audio/tea-ambience.a9b55c.webm', type: 'audio/webm; codecs=opus' },
  { src: '/audio/tea-ambience.483776.mp3', type: 'audio/mpeg' },
];

/** Sources the browser says it can play, in order; MP3 is always the last resort. */
export function backgroundMusicSources(canPlay: (type: string) => string) {
  const playable = BACKGROUND_MUSIC.filter(({ type }) => canPlay(type) !== '');
  const mp3 = BACKGROUND_MUSIC.at(-1)!;
  return [...new Set([...playable, mp3].map(({ src }) => src))];
}

/**
 * Loop points in seconds that skip codec padding a decoder leaves at either
 * end. The loop has no silence of its own, so any quiet edge is padding.
 */
export function loopBounds(samples: Float32Array, sampleRate: number) {
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]) < 1e-4) start++;
  while (end > start && Math.abs(samples[end - 1]) < 1e-4) end--;
  return { start: start / sampleRate, end: end / sampleRate };
}

// Storage defaults to localStorage, read inside the try: the getter itself
// throws when the browser blocks site data.

/** On unless the guest turned it off. */
export function readBackgroundMusic(
  storage?: Pick<Storage, 'getItem'>,
): boolean {
  try {
    return (storage ?? localStorage).getItem(BACKGROUND_MUSIC_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeBackgroundMusic(
  enabled: boolean,
  storage?: Pick<Storage, 'setItem'>,
) {
  try {
    (storage ?? localStorage).setItem(
      BACKGROUND_MUSIC_KEY,
      enabled ? 'on' : 'off',
    );
  } catch {
    /* Private mode and blocked storage keep the in-memory choice. */
  }
}
