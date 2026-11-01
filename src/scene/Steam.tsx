import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Sprite, SpriteMaterial } from 'three';
import { createRandom, damp } from './motion/dynamics';
import type { Point } from './stations';
import { once } from './Surfaces';

/** A soft, torn wisp: radial falloff broken up by value noise. */
function wispTexture() {
  const size = 128,
    canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!,
    image = ctx.createImageData(size, size),
    random = createRandom(449),
    grid = 8,
    lattice = Array.from({ length: grid * grid }, () => random());
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      fx = x - xi,
      fy = y - yi,
      at = (i: number, j: number) => lattice[(j % grid) * grid + (i % grid)];
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        dx = (u - 0.5) * 2,
        dy = (v - 0.5) * 1.6,
        falloff = Math.max(0, 1 - Math.hypot(dx, dy)) ** 1.6,
        torn =
          noise(u * 4, v * 4) * 0.6 +
          noise(u * 8 + 3, v * 8 + 1) * 0.3 +
          noise(u * 16 + 5, v * 16 + 7) * 0.1,
        alpha = falloff * Math.max(0, torn * 1.5 - 0.35),
        i = (y * size + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 246;
      image.data[i + 2] = 232;
      image.data[i + 3] = Math.min(255, alpha * 255);
    }
  ctx.putImageData(image, 0, 0);
  return new CanvasTexture(canvas);
}
const wisp = once(wispTexture);

/** Soft billboards rising from one source: no simulation engine or shadow pass. */
export function Steam({
  origin,
  active,
  reduced,
  count = 10,
  strength = 1,
  rise = 0.5,
}: {
  origin: Point;
  active: boolean;
  reduced: boolean;
  count?: number;
  strength?: number;
  rise?: number;
}) {
  const sprites = useRef<(Sprite | null)[]>([]);
  const life = useRef({ time: 0, energy: 0 });
  const particles = useMemo(() => {
    const random = createRandom(449 + Math.round(origin[0] * 100));
    return Array.from({ length: count }, (_, index) => ({
      phase: (index + random() * 0.6) / count,
      speed: 0.11 + random() * 0.05,
      spread: 0.035 + random() * 0.05,
      size: 0.05 + random() * 0.04,
      seed: random() * 20,
      spin: (random() - 0.5) * 0.8,
    }));
  }, [count, origin]);
  const texture = wisp();
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05),
      state = life.current;
    state.energy = damp(state.energy, active ? 1 : 0, active ? 3.5 : 1.5, dt);
    if (!reduced) state.time += dt;
    const drift = Math.sin(state.time * 0.23) * 0.05;
    particles.forEach((p, index) => {
      const sprite = sprites.current[index];
      if (!sprite) return;
      const phase = (p.phase + (state.time * p.speed) / rise) % 1;
      const t = state.time + p.seed;
      sprite.position.set(
        Math.sin(t * 0.8 + phase * 5) * p.spread * phase +
          drift * phase * phase,
        phase * rise,
        Math.sin(t * 0.53 + phase * 3) * p.spread * 0.6 * phase,
      );
      sprite.scale.set(
        p.size * (0.6 + phase * 2.2),
        p.size * (0.9 + phase * 3),
        1,
      );
      const material = sprite.material as SpriteMaterial;
      material.rotation = p.spin * phase + Math.sin(t * 0.4) * 0.2;
      material.opacity = reduced
        ? 0
        : Math.sin(Math.PI * phase ** 0.8) ** 1.4 *
          (0.2 + state.energy * 0.22) *
          strength;
    });
  });
  return (
    <group name="tea-steam" position={origin} visible={!reduced}>
      {particles.map((_, i) => (
        <sprite
          key={i}
          ref={(node) => {
            sprites.current[i] = node;
          }}
        >
          <spriteMaterial
            map={texture}
            transparent
            depthWrite={false}
            opacity={0}
            color="#fff4e4"
          />
        </sprite>
      ))}
    </group>
  );
}
