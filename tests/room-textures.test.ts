import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roomTextures, SHELF_POSTERS } from '../src/ui/roomTextures';

const root = join(__dirname, '..');
const sources = ['src/scene', 'src/thesis']
  .flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true }).map((file) =>
      join(root, dir, String(file)),
    ),
  )
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

describe('room texture warm-up', () => {
  it('names files the room really loads', () => {
    for (const light of [false, true])
      for (const url of [...roomTextures(light), ...SHELF_POSTERS]) {
        expect(existsSync(join(root, 'public', url)), url).toBe(true);
        expect(sources, url).toContain(url.replace(/-(360|600)w\.webp$/, ''));
      }
  });
});
