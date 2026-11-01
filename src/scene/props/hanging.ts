import type { Point } from '../stations';

/** Side-wall nageshi. Cords stop under the soffit; the shank may enter the beam. */
export const NAGESHI = { bottom: 2.26, top: 2.38 };

/** Tokonoma lintel soffit. The kakejiku eye stays under it. */
export const TOKO_LINTEL_BOTTOM = 2.55;

/** Top of the wainscot rail. The scroll's lower roller stays clear of it. */
export const WAINSCOT_TOP = 0.985;

/**
 * Screw-eye radius. `2 * ring` is the old hanger offset (0.01 m) and
 * `ring * 0.26` is the old tube (0.0013 m), so the 茶 sign is unchanged.
 */
export const HANG_RING = 0.005;

/** Wall scrolls. The group origin is the hook. */
export const SCROLL_HOOK_Y = 2.255;
export const SCROLL = { width: 0.5, height: 1.12, drop: 0.11 };
/** Upper roller the cord leaves. */
export const SCROLL_ROD = { z: 0.004, radius: 0.009 };
/** Lower roller: `gap` below the paper, then its own radius. */
export const SCROLL_WEIGHT = { gap: 0.008, radius: 0.018 };

/**
 * One vertical cord from the upper roller to the eye. A V of cords reads as
 * two stray diagonals on the plaster above the nageshi.
 */
export const SCROLL_HANGER = {
  hook: [0, 0, 0.006] as Point,
  into: [0, 1, 0] as Point,
  ring: HANG_RING,
  end: [0, -SCROLL.drop + 0.006, 0.006] as Point,
};

/** Kakejiku inside the tokonoma. `originY` is the group's world height. */
export const KAKEJIKU_ORIGIN_Y = 1.62;
/** Upper roller. The cord leaves its crown and runs straight up to the eye. */
export const KAKEJIKU_ROD = { y: 0.755, z: 0.008, radius: 0.008 };
export const KAKEJIKU_HANGER = {
  hook: [0, 0.9, KAKEJIKU_ROD.z] as Point,
  into: [0, 0, -1] as Point,
  ring: HANG_RING,
  end: [0, KAKEJIKU_ROD.y + KAKEJIKU_ROD.radius, KAKEJIKU_ROD.z] as Point,
};
