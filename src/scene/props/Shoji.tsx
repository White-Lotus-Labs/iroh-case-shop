import { useLayoutEffect, useMemo, useRef } from 'react';
import { Matrix4, type CanvasTexture, type InstancedMesh } from 'three';
import { Solid, canvasTexture, useSurfaceMaps } from '../Surfaces';
import type { Point } from '../stations';
import { createRandom } from '../motion/dynamics';

const frameColor = '#33200f';
const kumikoColor = '#6a4a30';
const stile = 0.036;
const topRail = 0.05;
const bottomRail = 0.075;

type Paint = CanvasRenderingContext2D;

function paintBranch(
  ctx: Paint,
  random: () => number,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
) {
  const bend = (random() - 0.5) * 0.9;
  const cx = x + Math.cos(angle + bend) * length * 0.5,
    cy = y + Math.sin(angle + bend) * length * 0.5,
    ex = x + Math.cos(angle) * length,
    ey = y + Math.sin(angle) * length;
  const at = (t: number) => [
    (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex,
    (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey,
  ];
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(cx, cy, ex, ey);
  ctx.stroke();
  const leaves = Math.max(3, Math.floor(length / 22));
  for (let i = 1; i <= leaves; i++) {
    const [px, py] = at(i / leaves - random() * 0.05),
      size = 16 + random() * 20,
      turn = angle + (i % 2 ? 1 : -1) * (0.5 + random() * 0.7);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(turn);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(size * 0.45, size * 0.28, size, 0);
    ctx.quadraticCurveTo(size * 0.45, -size * 0.28, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  if (depth > 0)
    for (let k = 0; k < 3; k++) {
      const [px, py] = at(0.25 + random() * 0.6);
      paintBranch(
        ctx,
        random,
        px,
        py,
        angle + (random() - 0.5) * 1.8,
        length * (0.4 + random() * 0.25),
        width * 0.55,
        depth - 1,
      );
    }
}

/** Sunlit washi with fibres and the blurred shadow of a leafy branch entering from one side. */
function paintWashi(ctx: Paint, w: number, h: number, seed: number) {
  const random = createRandom(seed);
  const hot = ctx.createRadialGradient(
    w * 0.5,
    h * 0.3,
    0,
    w * 0.5,
    h * 0.4,
    Math.max(w, h) * 0.75,
  );
  hot.addColorStop(0, '#fff1d6');
  hot.addColorStop(0.55, '#f1d09e');
  hot.addColorStop(1, '#c99a62');
  ctx.fillStyle = hot;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 1600; i++) {
    const x = random() * w,
      y = random() * h,
      a = random() * Math.PI,
      l = 4 + random() * 18;
    ctx.strokeStyle = `rgba(150,100,55,${random() * 0.08})`;
    ctx.lineWidth = 0.5 + random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * l * 0.5 + (random() - 0.5) * 5,
      y + Math.sin(a) * l * 0.5,
      x + Math.cos(a) * l,
      y + Math.sin(a) * l,
    );
    ctx.stroke();
  }
  const shade = document.createElement('canvas');
  shade.width = w;
  shade.height = h;
  const s = shade.getContext('2d')!;
  s.lineCap = 'round';
  s.fillStyle = s.strokeStyle = '#3a200e';
  const side = random() < 0.5 ? 0 : 1;
  const layer = (blur: number, alpha: number, scale: number) => {
    s.clearRect(0, 0, w, h);
    paintBranch(
      s,
      random,
      side * w + (side ? 30 : -30),
      h * (0.05 + random() * 0.25),
      side ? Math.PI * 0.82 : Math.PI * 0.18,
      w * 0.55 * scale,
      9 * scale,
      2,
    );
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    ctx.drawImage(shade, 0, 0);
    ctx.restore();
  };
  layer(10, 0.34, 1.25);
  layer(3, 0.42, 0.9);
}

const washi = new Map<string, CanvasTexture>();

/** A lit shoji window in the local XY plane facing +z: sliding panels, instanced kumiko, glowing washi. */
export function ShojiWindow({
  position,
  rotation = 0,
  width,
  height,
  panels = 2,
  cols = 3,
  rows = 6,
  glow = 0.8,
  seed = 1,
}: {
  position: Point;
  rotation?: number;
  width: number;
  height: number;
  panels?: number;
  cols?: number;
  rows?: number;
  glow?: number;
  seed?: number;
}) {
  const wood = useSurfaceMaps('wood');
  const px = 512,
    py = Math.round((px * height) / width),
    key = `${py}:${seed}`;
  let paper = washi.get(key);
  if (!paper)
    washi.set(
      key,
      (paper = canvasTexture(px, py, (ctx) => paintWashi(ctx, px, py, seed))),
    );
  const overlap = stile;
  const pw = (width + overlap * (panels - 1)) / panels;
  const layout = Array.from({ length: panels }, (_, i) => ({
    x: -width / 2 + pw / 2 + i * (pw - overlap),
    z: i % 2 ? 0.012 : 0.042,
  }));
  const bars = useMemo(() => {
    const matrices: Matrix4[] = [];
    const innerW = pw - stile * 2,
      innerH = height - topRail - bottomRail,
      midY = (bottomRail - topRail) / 2;
    for (let i = 0; i < panels; i++) {
      const x = -width / 2 + pw / 2 + i * (pw - overlap),
        z = i % 2 ? 0.012 : 0.042;
      for (let c = 1; c < cols; c++)
        matrices.push(
          new Matrix4()
            .makeScale(0.011, innerH, 0.016)
            .setPosition(x - innerW / 2 + (innerW * c) / cols, midY, z),
        );
      for (let r = 1; r < rows; r++)
        matrices.push(
          new Matrix4()
            .makeScale(innerW, 0.011, 0.016)
            .setPosition(x, midY - innerH / 2 + (innerH * r) / rows, z),
        );
    }
    return matrices;
  }, [pw, width, overlap, height, cols, rows, panels]);
  const lattice = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = lattice.current!;
    bars.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [bars]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0, -0.004]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={paper}
          emissive="#ffb468"
          emissiveMap={paper}
          emissiveIntensity={glow}
          roughness={0.95}
        />
      </mesh>
      <instancedMesh ref={lattice} args={[undefined, undefined, bars.length]}>
        <boxGeometry />
        <meshStandardMaterial
          color={kumikoColor}
          map={wood.color}
          roughnessMap={wood.rough}
          roughness={1}
        />
      </instancedMesh>
      {layout.map(({ x, z }) => (
        <group key={x} position={[x, 0, z]}>
          {[-1, 1].map((sx) => (
            <Solid
              key={sx}
              position={[sx * (pw / 2 - stile / 2), 0, 0]}
              size={[stile, height, 0.03]}
              color={frameColor}
              cast={false}
            />
          ))}
          <Solid
            position={[0, height / 2 - topRail / 2, 0]}
            size={[pw - stile * 2, topRail, 0.028]}
            color={frameColor}
            cast={false}
          />
          <Solid
            position={[0, -height / 2 + bottomRail / 2, 0]}
            size={[pw - stile * 2, bottomRail, 0.028]}
            color={frameColor}
            cast={false}
          />
          <mesh
            position={[
              (pw / 2 - stile - 0.05) * (x < 0 ? 1 : -1),
              -0.05,
              0.016,
            ]}
          >
            <boxGeometry args={[0.018, 0.07, 0.004]} />
            <meshStandardMaterial
              color="#1a120c"
              roughness={0.45}
              metalness={0.4}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
