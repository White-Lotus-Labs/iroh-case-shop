// Proximity field and spring from ThreeUI's Animated Top Dock, x axis only.
const PROXIMITY = 170;
const SPRING = 0.19;
const DAMPING = 0.7;
const WIDTH_GROWTH = 18;
const SEAL_SPRING = 0.13;
const SEAL_DAMPING = 0.66;
const MIN_MAGNIFY_WIDTH = 760;

type ItemState = {
  element: HTMLElement;
  baseWidth: number;
  value: number;
  velocity: number;
  target: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function createDockSpring(root: HTMLElement, reduced: boolean) {
  const precision = window.matchMedia('(hover: hover) and (pointer: fine)');
  const seal = root.querySelector<HTMLElement>('[data-dock-seal]');
  const items: ItemState[] = Array.from(
    root.querySelectorAll<HTMLElement>('[data-dock-item]'),
    (element) => ({ element, baseWidth: 0, value: 0, velocity: 0, target: 0 }),
  );
  const sealState = { x: 0, velocity: 0 };
  let magnify = false;
  let frame = 0;

  // offsetLeft ignores the items' transforms, so the seal tracks layout only.
  const sealTarget = () => {
    const active = root.querySelector<HTMLElement>('[aria-current="step"]');
    return active ? active.offsetLeft + active.offsetWidth / 2 : null;
  };
  const placeSeal = (x: number) => {
    sealState.x = x;
    if (seal) seal.style.transform = `translateX(${x.toFixed(2)}px)`;
  };

  const write = (state: ItemState) => {
    const value = clamp(state.value, 0, 1.08);
    state.element.style.setProperty('--dock-v', value.toFixed(3));
    state.element.style.width = `${(state.baseWidth + WIDTH_GROWTH * value).toFixed(2)}px`;
  };

  const step = () => {
    frame = 0;
    let moving = false;
    for (const state of items) {
      state.velocity =
        (state.velocity + (state.target - state.value) * SPRING) * DAMPING;
      state.value += state.velocity;
      if (
        Math.abs(state.target - state.value) < 0.001 &&
        Math.abs(state.velocity) < 0.001
      ) {
        state.value = state.target;
        state.velocity = 0;
      } else moving = true;
      if (magnify) write(state);
    }
    const target = sealTarget();
    if (target !== null) {
      if (reduced) placeSeal(target);
      else {
        sealState.velocity =
          (sealState.velocity + (target - sealState.x) * SEAL_SPRING) *
          SEAL_DAMPING;
        if (
          Math.abs(target - sealState.x) < 0.1 &&
          Math.abs(sealState.velocity) < 0.1
        ) {
          sealState.velocity = 0;
          placeSeal(target);
        } else {
          moving = true;
          placeSeal(sealState.x + sealState.velocity);
        }
      }
    }
    if (moving) kick();
  };
  const kick = () => {
    if (!frame) frame = requestAnimationFrame(step);
  };

  const measure = () => {
    magnify =
      !reduced && precision.matches && window.innerWidth > MIN_MAGNIFY_WIDTH;
    for (const state of items) {
      state.element.style.width = '';
      state.element.style.removeProperty('--dock-v');
    }
    for (const state of items)
      state.baseWidth = state.element.getBoundingClientRect().width;
    // A re-measure keeps the hover state so a resting pointer stays magnified.
    for (const state of items) {
      if (magnify) write(state);
      else state.value = state.velocity = state.target = 0;
    }
    root.style.setProperty('--dock-half', `${root.offsetWidth / 2}px`);
    const target = sealTarget();
    if (target !== null) placeSeal(target);
    sealState.velocity = 0;
    kick();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!magnify) return;
    for (const state of items) {
      const rect = state.element.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const near = clamp(
        1 - Math.abs(event.clientX - center) / PROXIMITY,
        0,
        1,
      );
      state.target = near * near * (3 - 2 * near);
    }
    kick();
  };
  const reset = () => {
    for (const state of items) state.target = 0;
    kick();
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    if (!magnify || !target.matches(':focus-visible')) return;
    const index = items.findIndex(
      (state) => state.element === target.closest('[data-dock-item]'),
    );
    items.forEach((state, i) => {
      state.target = i === index ? 1 : Math.abs(i - index) === 1 ? 0.24 : 0;
    });
    kick();
  };
  const onFocusOut = () =>
    requestAnimationFrame(() => {
      if (!root.contains(document.activeElement)) reset();
    });

  let released = false;
  document.fonts?.ready.then(() => {
    if (!released) measure();
  });
  // Observe the parent: the dock resizes itself while magnifying.
  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(root.parentElement ?? root);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', reset);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  precision.addEventListener('change', measure);
  measure();

  return {
    update: kick,
    destroy() {
      released = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', reset);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      precision.removeEventListener('change', measure);
      for (const state of items) {
        state.element.style.width = '';
        state.element.style.removeProperty('--dock-v');
      }
    },
  };
}
