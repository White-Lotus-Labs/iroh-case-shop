import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_MUSIC,
  BACKGROUND_MUSIC_KEY,
  backgroundMusicSources,
  loopBounds,
  readBackgroundMusic,
  writeBackgroundMusic,
} from '../src/ui/backgroundMusic';

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('background music preference', () => {
  it('is on until the guest turns it off', () => {
    const storage = memory();
    expect(readBackgroundMusic(storage)).toBe(true);
    writeBackgroundMusic(false, storage);
    expect(storage.getItem(BACKGROUND_MUSIC_KEY)).toBe('off');
    expect(readBackgroundMusic(storage)).toBe(false);
    writeBackgroundMusic(true, storage);
    expect(readBackgroundMusic(storage)).toBe(true);
  });

  it('ignores storage that throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readBackgroundMusic(storage)).toBe(true);
    expect(() => writeBackgroundMusic(true, storage)).not.toThrow();
  });
});

describe('background music file', () => {
  it('ships every source', () => {
    for (const { src } of BACKGROUND_MUSIC)
      expect(existsSync(join(__dirname, '../public', src)), src).toBe(true);
  });

  it('prefers Opus and keeps MP3 as the fallback', () => {
    const [opus, mp3] = BACKGROUND_MUSIC.map(({ src }) => src);
    expect(backgroundMusicSources(() => 'probably')).toEqual([opus, mp3]);
    expect(
      backgroundMusicSources((type) => (type.includes('opus') ? '' : 'maybe')),
    ).toEqual([mp3]);
    expect(backgroundMusicSources(() => '')).toEqual([mp3]);
  });

  it('loops past decoder padding at both ends', () => {
    const samples = new Float32Array([0, 0, 0.2, -0.1, 0.3, 0.00001, 0]);
    expect(loopBounds(samples, 1)).toEqual({ start: 2, end: 5 });
  });
});
