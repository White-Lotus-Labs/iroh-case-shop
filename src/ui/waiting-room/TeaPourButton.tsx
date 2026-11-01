'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import { whenBookRests } from './bookMotion';

// A black raku chawan seen from above. A tokoname kyusu pours sencha into it
// while the room loads; the pool grows to the rim, then the pot withdraws.

// The canvas overhangs the bowl (in bowl radii) so the spout and the steam can
// leave it. Keep in step with `.waiting-enter-gl` in WaitingRoom.css.
const SPAN = 1.6;
// Pool radius when full; the lip starts at 0.8.
const POOL = 0.72;
const LAND: [number, number] = [0.55, 0.83];
const LAMP: [number, number, number] = [-0.62, 0.76, 2.2];
/** Fastest the bowl fills while the room loads, in bowls per second. */
const FILL_RATE = 1 / 12;

const VERT = `#version 300 es
void main() {
  vec2 v = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(v * 2. - 1., 0., 1.);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uSpan, uT, uPool, uReady, uSpout, uSteam;
uniform vec2 uLand;
uniform vec3 uStream; // head, tail (0 at the spout .. 1 at the surface), rings
uniform vec3 uLight;
uniform vec4 uWell;   // pointer x, y, amount, speed
uniform vec4 uRip[3]; // x, y, age, on
out vec4 fragColor;

#define PI 3.14159265
const float RI = 0.8;
const vec2 TIP = vec2(0.84, 0.56);
const vec2 POT = vec2(1.62, 1.08);
const vec3 CAM = vec3(0., 0., 2.8);
const vec3 LAMP = vec3(1., 0.8, 0.52);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + 1.), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0., a = .5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.; a *= .5; }
  return s;
}
float seg(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 pa = p - a, ba = b - a;
  h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * h);
}
// A round cross-section normal for a tube along a -> b.
vec3 tube(vec2 p, vec2 a, vec2 b, float d, float w) {
  vec2 dir = normalize(b - a);
  float s = sign(dir.x * (p.y - a.y) - dir.y * (p.x - a.x));
  float x = clamp(d / w, 0., .98) * s;
  return normalize(vec3(vec2(-dir.y, dir.x) * x, sqrt(1. - x * x)));
}
vec3 lit(vec3 base, vec3 n, vec3 pos, float gloss, float shine) {
  vec3 L = normalize(uLight - pos);
  vec3 V = normalize(CAM - pos);
  float dif = max(dot(n, L), 0.);
  float spec = pow(max(dot(reflect(-L, n), V), 0.), gloss);
  return base * (0.3 + 0.85 * dif) + LAMP * spec * shine;
}
float surface(vec2 q) {
  float d = length(q - uLand);
  float h = uStream.z * 0.004 * sin(d * 40. - uT * 11.) * exp(-d * 3.6);
  for (int i = 0; i < 3; i++) {
    vec4 r = uRip[i];
    if (r.w < .5) continue;
    float x = length(q - r.xy) - r.z * 0.9;
    h += 0.008 * cos(x * 22.) * exp(-x * x * 26.) * exp(-r.z * 1.3);
  }
  vec2 w = q - uWell.xy;
  h -= uWell.z * (0.003 + 0.012 * uWell.w) * exp(-dot(w, w) * 10.);
  return h + 0.0015 * sin(q.x * 6. + uT * .7) * sin(q.y * 5. - uT * .5);
}

void main() {
  vec2 p = (gl_FragCoord.xy / uRes * 2. - 1.) * uSpan;
  float px = 2. * uSpan / uRes.y;
  float r = length(p);
  float ang = atan(p.y, p.x);
  // Hand-thrown: the bowl is not quite round.
  float rr = r / (1. + 0.011 * sin(3. * ang + 0.7) + 0.006 * sin(7. * ang + 2.1));
  vec2 nd = p / max(r, 1e-4);
  vec4 col = vec4(0.);

  if (rr < 1. + 2. * px) {
    float g = fbm(p * 6. + 3.1);
    float t = clamp((rr - RI) / (1. - RI), 0., 1.);
    vec3 nl = normalize(vec3(nd * -cos(t * PI) * 1.1, 0.45 + 0.55 * sin(t * PI)));
    float crack = smoothstep(0.04, 0., abs(noise(p * 19.) - .5));
    vec3 raku = mix(vec3(0.05, 0.036, 0.03), vec3(0.15, 0.095, 0.065), g) * (1. - crack * 0.3);
    vec3 lip = lit(raku, nl, vec3(p, 0.), 36., 0.5);
    float gold = smoothstep(0.09, 0.02, abs(t - 0.85));
    lip = mix(lip, lit(vec3(0.72, 0.53, 0.29) * (0.72 + 0.5 * uReady), nl, vec3(p, 0.), 22., 0.6 + 0.5 * uReady), gold);

    float q = min(rr / RI, 0.999);
    float wall = sqrt(1. - q * q);
    vec3 ni = normalize(vec3(-p / RI, wall));
    vec3 c = lit(mix(vec3(0.03, 0.022, 0.019), vec3(0.08, 0.055, 0.042), g), ni, vec3(p, -wall * RI), 70., 0.4);
    c *= 0.45 + 0.55 * smoothstep(RI, RI * 0.68, rr);

    if (uPool > 0.002 && rr < uPool + 2. * px) {
      float h = surface(p);
      float e = 0.006;
      vec3 n = normalize(vec3(h - surface(p + vec2(e, 0.)), h - surface(p + vec2(0., e)), e));
      float zs = -sqrt(RI * RI - uPool * uPool);
      float depth = max(wall * RI + zs, 0.);
      // Clear sencha over black glaze: gold-green where shallow, deep jade below.
      vec3 body = mix(vec3(0.44, 0.43, 0.14), vec3(0.05, 0.1, 0.03), 1. - exp(-depth * 20.));
      body = mix(c, body, 1. - exp(-depth * 60.));
      body *= 0.92 + 0.16 * fbm(vec2(ang * 3. + rr * 6. - uT * 0.12, rr * 9.));
      vec3 pos = vec3(p, zs + h);
      vec3 R = reflect(normalize(pos - CAM), n);
      vec3 L = normalize(uLight - pos);
      // A flat mirror: the lantern shows as one small, tall glint.
      vec3 dv = R - L;
      float glint = exp(-(dv.x * dv.x / 0.0004 + dv.y * dv.y / 0.0013));
      float halo = pow(max(dot(R, L), 0.), 220.);
      // Slopes that face the lantern catch it, so rings and the pointer's dimple show.
      float slope = dot(n.xy, normalize(L.xy + 1e-4));
      float flicker = 0.9 + 0.1 * sin(uT * 2.3) * sin(uT * 3.7 + 1.);
      vec3 tea = body * (1. - 0.6 * min(slope, 0.))
        + LAMP * (flicker * (glint * 1.5 + halo * 0.06) + max(slope, 0.) * 0.9);
      float froth = uStream.z * smoothstep(0.07, 0., length(p - uLand))
        * smoothstep(0.5, 0.85, noise(p * 70. + uT * 4.));
      tea += vec3(0.75, 0.74, 0.48) * froth * 0.4;
      c = mix(c, tea, smoothstep(uPool + px, uPool - px, rr));
      c += vec3(0.85, 0.8, 0.6) * 0.22 * exp(-pow((rr - uPool) / (px * 1.6), 2.)) * smoothstep(0., 0.06, uPool);
    }
    c = mix(c, lip, smoothstep(RI - px, RI + px, rr));
    col = vec4(c, 1.) * smoothstep(1. + px, 1. - px, rr);
  }

  vec2 drop = vec2(0.05, -0.075);
  float hs, hh;
  float ds = seg(p, TIP, uLand, hs);
  float dh = seg(p - drop, TIP, uLand, hh);
  float along = smoothstep(uStream.y - 0.03, uStream.y + 0.01, hs) * smoothstep(uStream.x + 0.01, uStream.x - 0.03, hs);
  float alongH = smoothstep(uStream.y - 0.03, uStream.y + 0.01, hh) * smoothstep(uStream.x + 0.01, uStream.x - 0.03, hh);
  col.rgb *= 1. - 0.35 * smoothstep(0.06, 0., dh) * alongH;
  float sw = mix(0.032, 0.02, hs) * (1. + 0.12 * sin(hs * 34. - uT * 22.));
  float sm = smoothstep(sw + px, sw - px, ds) * along;
  if (sm > 0.) {
    vec3 sn = tube(p, TIP, uLand, ds, sw);
    // Thin tea is clear gold; light runs down its crown.
    vec3 sc = lit(vec3(0.5, 0.47, 0.2), sn, vec3(p, 0.3), 80., 1.2);
    sc += vec3(0.9, 0.8, 0.5) * pow(sn.z, 8.) * 0.12;
    col = mix(col, vec4(sc, 1.), sm * 0.8);
  }

  if (uSpout > 0.001) {
    vec2 ps = p - normalize(POT - TIP) * (1. - uSpout) * 0.5;
    float hk, hk2;
    float dk = seg(ps, POT, TIP, hk);
    float dk2 = seg(ps - drop, POT, TIP, hk2);
    // A short spout that comes out of the dusk; the pot stays out of frame.
    float kr = mix(0.15, 0.064, smoothstep(0.2, 1., hk));
    float fade = smoothstep(0.3, 0.62, hk) * uSpout;
    col.rgb *= 1. - 0.45 * smoothstep(0.04, -0.02, dk2 - mix(0.15, 0.064, smoothstep(0.2, 1., hk2))) * smoothstep(0.3, 0.62, hk2) * uSpout;
    float km = smoothstep(kr + px, kr - px, dk) * fade;
    if (km > 0.) {
      vec3 clay = vec3(0.34, 0.13, 0.075) * (0.8 + 0.4 * fbm(ps * 16.));
      vec3 kc = lit(clay, tube(ps, POT, TIP, dk, kr), vec3(ps, 0.4), 40., 0.3);
      // The mouth: a dark opening in a paler turned lip.
      float m = length(ps - TIP);
      kc = mix(kc, vec3(0.5, 0.27, 0.16), smoothstep(0.066, 0.056, m));
      kc = mix(kc, vec3(0.04, 0.025, 0.018), smoothstep(0.047, 0.038, m));
      col = mix(col, vec4(kc, 1.), km);
    }
  }

  if (uSteam > 0.001) {
    // Steam rises off the far side of the tea and past the rim, clear of the label.
    vec2 sq = vec2(p.x * 1.5 + 0.35 * sin(p.y * 1.8 - uT * 0.6), p.y * 1.1 - uT * 0.3);
    float s = fbm(sq + 0.6 * fbm(sq * 1.3 + uT * 0.05));
    float wisp = smoothstep(0.13, 0., abs(s - 0.5))
      * smoothstep(0.25, 0.6, p.y) * smoothstep(1.3, 0.95, p.y) * smoothstep(0.9, 0.35, abs(p.x))
      * uSteam * 0.13;
    col = col * (1. - wisp) + vec4(0.96, 0.9, 0.8, 1.) * wisp;
  }
  fragColor = col;
}`;

function link(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, FRAG],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  // Not checked here: asking for LINK_STATUS now would block until the driver
  // links, a few hundred ms on ANGLE/D3D11 while the sketchbook opens.
  gl.linkProgram(program);
  return program;
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    res: at('uRes'),
    span: at('uSpan'),
    t: at('uT'),
    pool: at('uPool'),
    ready: at('uReady'),
    spout: at('uSpout'),
    steam: at('uSteam'),
    land: at('uLand'),
    stream: at('uStream'),
    light: at('uLight'),
    well: at('uWell'),
    rip: at('uRip'),
  };
}

const ease = (from: number, to: number, dt: number, rate: number) =>
  from + (to - from) * (1 - Math.exp(-dt * rate));

export function TeaPourButton({
  fill,
  ready,
  disabled,
  reduced,
  onClick,
}: {
  fill: number;
  ready: boolean;
  disabled: boolean;
  reduced: boolean;
  onClick: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ fill, ready, reduced });
  live.current = { fill, ready, reduced };
  const wake = useRef(() => {});

  useEffect(() => wake.current(), [fill, ready, reduced]);

  useEffect(() => {
    // Creating a WebGL context blocks the page for a few hundred ms, so the
    // CSS bowl pours until the sketchbook rests.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void whenBookRests().then(() => {
      if (!cancelled) stop = start();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  function start() {
    const btn = button.current;
    const cv = canvas.current;
    const gl = cv?.getContext('webgl2', { premultipliedAlpha: true });
    const program = gl && link(gl);
    if (!btn || !cv || !gl || !program) return;
    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    let found: ReturnType<typeof uniforms> | null = null;
    let broken = false;
    // The CSS bowl shows until the driver has linked the program in the background.
    const linked = () => {
      if (found) return found;
      if (
        parallel &&
        !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)
      )
        return null;
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        broken = true;
        return null;
      }
      gl.useProgram(program);
      return (found = uniforms(gl, program));
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const ripples: { x: number; y: number; t: number }[] = [];
    const rip = new Float32Array(12);
    const ptr = { x: 0, y: 0, near: false };
    const well = { x: 0, y: 0, amount: 0, speed: 0 };
    let level = live.current.ready ? 1 : live.current.fill;
    // A room that is ready on arrival has its tea poured already.
    let pouring = false;
    let head = 0;
    let tail = 0;
    let rings = 0;
    let spout = 0;
    let steam = 0;
    let glow = live.current.ready ? 1 : 0;
    let clock = 2;
    let last = performance.now();
    let drawn = '';
    let raf = 0;

    const still = () => live.current.reduced || media.matches;
    const add = (x: number, y: number) => {
      if (still()) return;
      ripples.push({ x, y, t: clock });
      if (ripples.length > 3) ripples.shift();
    };
    const local = (event: PointerEvent) => {
      const box = btn.getBoundingClientRect();
      const half = box.width / 2;
      return [
        (event.clientX - box.left - half) / half,
        (box.top + half - event.clientY) / half,
      ];
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      [ptr.x, ptr.y] = local(event);
      ptr.near = Math.hypot(ptr.x, ptr.y) < 1.5;
    };
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) ptr.near = false;
    };
    // On the window: a disabled button gets no pointer events, and the
    // tea should still answer a tap while it fills.
    const down = (event: PointerEvent) => {
      const [x, y] = local(event);
      if (Math.hypot(x, y) < 0.95) add(x, y);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat)
        add(0, 0);
    };
    // ponytail: a lost context is not restored; the CSS bowl takes over until
    // the next mount. Handle webglcontextrestored if that ever matters.
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(raf);
      delete btn.dataset.gl;
    };
    // A still bowl stops the loop once drawn; a change starts it again.
    const rouse = () => {
      if (raf || gl.isContextLost()) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    let size = 0;
    const resize = new ResizeObserver(([entry]) => {
      size = Math.round(
        entry.contentRect.width * Math.min(window.devicePixelRatio || 1, 2),
      );
      rouse();
    });
    // Where the stream lands: near the well while the pool is small.
    const landing = (): [number, number] => {
      const reach = Math.min(0.3, POOL * Math.sqrt(level) * 0.6);
      const n = Math.hypot(LAND[0], LAND[1]);
      return [(LAND[0] / n) * reach, (LAND[1] / n) * reach];
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { fill: goal, ready: done } = live.current;
      const target = done ? 1 : Math.min(goal, 0.99);
      const calm = still();
      if (calm) {
        level = target;
        head = tail = rings = spout = steam = well.amount = 0;
        glow = done ? 1 : 0;
        ripples.length = 0;
      } else {
        clock += dt;
        // A slow pour while the guest reads: at most a full bowl in ~12 s.
        // Once the room is ready the last of it goes in quickly.
        level = done
          ? ease(level, target, dt, 2.5)
          : level + Math.max(-dt, Math.min(target - level, dt * FILL_RATE));
        glow = ease(glow, done ? 1 : 0, dt, 2);
        if (!done) pouring = true;
        if (pouring && (!done || level < 0.97)) {
          tail = 0;
          spout = ease(spout, 1, dt, 6);
          if (spout > 0.85) head = Math.min(head + dt * 3.2, 1);
        } else if (pouring) {
          // The pot lifts: the stream breaks at the spout and its tail falls in.
          tail = Math.min(tail + dt * 2.6, 1);
          if (tail >= 1) {
            pouring = false;
            head = tail = 0;
            add(...landing());
          }
        } else {
          spout = ease(spout, 0, dt, 3);
        }
        rings = ease(rings, head > tail ? 1 : 0, dt, head > tail ? 4 : 1.5);
        steam = ease(steam, done && !pouring ? 1 : 0, dt, 0.7);
        const lag = 1 - Math.exp(-dt * 9);
        const dx = (ptr.x - well.x) * lag;
        const dy = (ptr.y - well.y) * lag;
        well.x += dx;
        well.y += dy;
        const pace = Math.min(Math.hypot(dx, dy) / Math.max(dt, 1e-3) / 4, 1);
        well.speed = ease(well.speed, pace, dt, pace > well.speed ? 12 : 3);
        well.amount = ease(well.amount, ptr.near ? 1 : 0, dt, 5);
      }

      const u = linked();
      if (!u) {
        if (broken) cancelAnimationFrame(raf);
        return;
      }
      if (size && cv.width !== size) cv.width = cv.height = size;
      const sig = calm ? `${level}|${glow}|${size}` : '';
      if (!size || (sig && sig === drawn)) {
        if (sig) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        return;
      }
      drawn = sig;

      const pool = POOL * Math.sqrt(level);
      const [lx, ly] = landing();
      const k = well.amount * 0.8;
      for (let i = 0; i < 3; i++) {
        const r = ripples[i];
        const age = r ? clock - r.t : 99;
        rip.set(r ? [r.x, r.y, age, age < 3.5 ? 1 : 0] : [0, 0, 0, 0], i * 4);
      }
      gl.viewport(0, 0, size, size);
      gl.uniform2f(u.res, size, size);
      gl.uniform1f(u.span, SPAN);
      gl.uniform1f(u.t, clock);
      gl.uniform1f(u.pool, pool);
      gl.uniform1f(u.ready, glow);
      gl.uniform1f(u.spout, spout);
      gl.uniform1f(u.steam, steam);
      gl.uniform2f(u.land, lx, ly);
      gl.uniform3f(u.stream, head, tail, rings);
      // The lantern's glint settles just above and left of the pointer.
      gl.uniform3f(
        u.light,
        LAMP[0] + ((well.x - 0.2) * 1.8 - LAMP[0]) * k,
        LAMP[1] + ((well.y + 0.22) * 1.8 - LAMP[1]) * k,
        LAMP[2],
      );
      gl.uniform4f(u.well, well.x, well.y, well.amount, well.speed);
      gl.uniform4fv(u.rip, rip);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!('gl' in btn.dataset)) btn.dataset.gl = '';
    };

    resize.observe(cv);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointerout', out);
    btn.addEventListener('keydown', key);
    cv.addEventListener('webglcontextlost', lost);
    media.addEventListener('change', rouse);
    wake.current = rouse;
    raf = requestAnimationFrame(frame);
    return () => {
      wake.current = () => {};
      media.removeEventListener('change', rouse);
      cancelAnimationFrame(raf);
      resize.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerout', out);
      btn.removeEventListener('keydown', key);
      cv.removeEventListener('webglcontextlost', lost);
      gl.deleteProgram(program);
      delete btn.dataset.gl;
    };
  }

  return (
    <button
      ref={button}
      type="button"
      className="waiting-enter"
      style={{ '--pool': Math.sqrt(fill) } as CSSProperties}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="waiting-enter-bowl" aria-hidden="true">
        <span className="waiting-enter-tea" />
      </span>
      <canvas ref={canvas} className="waiting-enter-gl" aria-hidden="true" />
      <span className="waiting-enter-label">Enter Teashop</span>
    </button>
  );
}
