// Accordion dock: the hovered item opens like a folded paper panel, the rest
// fold smoothly. Based on ThreeUI's Animated Top Dock proximity field (x axis).
//
// The dock keeps a fixed width; the items share it through flex-grow, which the
// CSS derives from --dock-v. JS only animates --dock-v (a spring per item) and
// moves the seal. No per-frame width writes, no layout reads.

const PROXIMITY = 200; // px, reach of the hover wave
// Opening is quick and responsive; folding back is slower and softer.
// DAMPING ≈ 2·sqrt(STIFFNESS) everywhere: critically damped, no wobble.
const STIFFNESS_IN = 190;
const DAMPING_IN = 28;
const STIFFNESS_OUT = 64;
const DAMPING_OUT = 16;
// The goal is eased before it reaches the spring, so motion starts gently
// instead of with the spring's full force (that was the abrupt "snap").
const TAU_IN = 0.04; // s
const TAU_OUT = 0.15; // s
const LEAVE_DELAY = 90; // ms of grace before folding, so a small slip doesn't collapse the dock
const MIN_MAGNIFY_WIDTH = 760;
const SEAL_ANCHOR = 0.5; // 0 left edge of the item, 0.5 centre, 1 right edge
const SEAL_DELAY_FIRST = 'calc(var(--dock-unroll) * 0.9)';
const SEAL_DELAY_AFTER = '140ms';

type Spring = { x: number; v: number; target: number; goal: number };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// Frame-rate independent: behaves the same on 60 and 120 Hz screens.
const step = (
  s: Spring,
  dt: number,
  eps: number,
  stiffness = STIFFNESS_IN,
  damping = DAMPING_IN,
) => {
  s.v += (stiffness * (s.target - s.x) - damping * s.v) * dt;
  s.x += s.v * dt;
  if (Math.abs(s.target - s.x) < eps && Math.abs(s.v) < eps) {
    s.x = s.target;
    s.v = 0;
    return false;
  }
  return true;
};

export function createDockSpring(root: HTMLElement, reduced: boolean) {
  const precision = window.matchMedia('(hover: hover) and (pointer: fine)');
  const paper = root.querySelector<HTMLElement>('.station-dock__paper')!;
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>('[data-dock-item]'),
  );
  const count = elements.length;
  const springs: Spring[] = elements.map(() => ({
    x: 0,
    v: 0,
    target: 0,
    goal: 0,
  }));
  // The seal's offset from its item; a spring pulls it to 0 when the station changes.
  const sealOff: Spring = { x: 0, v: 0, target: 0, goal: 0 };

  let magnify = false;
  let grow = 0.8;
  let padLeft = 0;
  let inner = 0;
  let frame = 0;
  let last = 0;
  let activeIndex = -1;
  let sealX: number | null = null;
  let sealTimer = 0;
  let leaveTimer = 0;

  root.style.setProperty('--dock-count', String(count));

  const findActive = () =>
    elements.findIndex((el) => el.getAttribute('aria-current') === 'step');

  // Item boxes from the spring values: exactly what flex computes
  // (basis 0, grow = 1 + v·grow, so the sum of grows is always >= 1).
  const boxes = () => {
    const weights = springs.map((s) => 1 + clamp(s.x, 0, 1) * grow);
    const total = weights.reduce((a, b) => a + b, 0);
    let left = padLeft;
    return weights.map((weight) => {
      const width = (inner * weight) / total;
      const box = { left, width };
      left += width;
      return box;
    });
  };

  const render = () => {
    if (magnify) {
      elements.forEach((el, i) =>
        el.style.setProperty('--dock-v', clamp(springs[i].x, 0, 1).toFixed(4)),
      );
    }
    const seal = root.querySelector<HTMLElement>('[data-dock-seal]');
    if (!seal || activeIndex < 0) return;
    const box = boxes()[activeIndex];
    sealX = box.left + box.width * SEAL_ANCHOR + sealOff.x;
    seal.style.transform = `translate3d(${sealX.toFixed(2)}px,0,0)`;
  };

  const tick = (now: number) => {
    frame = 0;
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    let moving = false;
    if (magnify) {
      for (const s of springs) {
        const releasing = s.goal < s.x;
        const tau = releasing ? TAU_OUT : TAU_IN;
        s.target += (s.goal - s.target) * (1 - Math.exp(-dt / tau));
        if (Math.abs(s.goal - s.target) < 0.0005) s.target = s.goal;
        const settling = step(
          s,
          dt,
          0.0005,
          releasing ? STIFFNESS_OUT : STIFFNESS_IN,
          releasing ? DAMPING_OUT : DAMPING_IN,
        );
        moving = settling || s.target !== s.goal || moving;
      }
    }
    moving = step(sealOff, dt, 0.05) || moving;
    render();
    if (moving) frame = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const measure = () => {
    magnify =
      !reduced && precision.matches && window.innerWidth > MIN_MAGNIFY_WIDTH;
    const navStyle = getComputedStyle(root);
    const paperStyle = getComputedStyle(paper);
    grow = parseFloat(navStyle.getPropertyValue('--dock-grow')) || 0.8;
    padLeft = parseFloat(paperStyle.paddingLeft) || 0;
    inner = Math.max(
      0,
      paper.clientWidth - padLeft - (parseFloat(paperStyle.paddingRight) || 0),
    );
    root.style.setProperty('--dock-half', `${paper.offsetWidth / 2}px`);
    if (!magnify) {
      for (const s of springs) s.x = s.v = s.target = s.goal = 0;
      elements.forEach((el) => el.style.removeProperty('--dock-v'));
    }
    // A re-measure keeps the hover state, so a resting pointer stays magnified.
    activeIndex = findActive();
    sealOff.x = sealOff.v = 0;
    render();
    kick();
  };

  const setTargets = (fn: (i: number) => number) => {
    window.clearTimeout(leaveTimer);
    springs.forEach((s, i) => (s.goal = fn(i)));
    kick();
  };
  const reset = () => setTargets(() => 0);
  const resetSoon = () => {
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(reset, LEAVE_DELAY);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!magnify || event.pointerType === 'touch') return;
    // Distance is measured to the resting slots, not to the moving items,
    // so the target never depends on the animation itself.
    const slot = inner / count;
    const x = event.clientX - paper.getBoundingClientRect().left - padLeft;
    setTargets((i) => {
      const near = clamp(1 - Math.abs(x - (i + 0.5) * slot) / PROXIMITY, 0, 1);
      return near * near * (3 - 2 * near);
    });
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    if (!magnify || !target.matches(':focus-visible')) return;
    const index = elements.findIndex(
      (el) => el === target.closest('[data-dock-item]'),
    );
    setTargets((i) => (i === index ? 1 : Math.abs(i - index) === 1 ? 0.24 : 0));
  };
  const onFocusOut = () =>
    requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) reset();
    });

  // The first seal waits for the scroll to unroll; later ones land right away.
  if (!reduced) {
    root.style.setProperty('--dock-seal-delay', SEAL_DELAY_FIRST);
    sealTimer = window.setTimeout(
      () => root.style.setProperty('--dock-seal-delay', SEAL_DELAY_AFTER),
      1800,
    );
  }

  let released = false;
  document.fonts?.ready.then(() => {
    if (!released) measure();
  });
  // The paper changes with the breakpoint, the parent with the window.
  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(root.parentElement ?? root);
  resizeObserver.observe(paper);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', resetSoon);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  precision.addEventListener('change', measure);
  measure();

  return {
    // Called after the active station changes: glide the seal from where it was.
    update() {
      const next = findActive();
      if (next !== activeIndex) {
        activeIndex = next;
        if (sealX !== null && next >= 0 && !reduced) {
          const box = boxes()[next];
          sealOff.x = sealX - (box.left + box.width * SEAL_ANCHOR);
          sealOff.v = 0;
        }
      }
      kick();
    },
    destroy() {
      released = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(sealTimer);
      window.clearTimeout(leaveTimer);
      resizeObserver.disconnect();
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', resetSoon);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      precision.removeEventListener('change', measure);
      elements.forEach((el) => el.style.removeProperty('--dock-v'));
    },
  };
}
