import { expect, test, type Page } from '@playwright/test';
import { registerBrowserAccount } from './auth-helper';
import { beginVisit } from './room-helpers';
import {
  keepInRoom,
  LOOK,
  STATIONS,
  type Point,
  type Room,
} from '../../src/scene/stations';

type Pose = { position: Point; target: Point; moving: boolean };
declare global {
  interface Window {
    __teaCamera: {
      pose(): Pose;
      project(point: Point): [number, number, number];
    };
  }
}

test.beforeEach(async ({ page }) => {
  await registerBrowserAccount(page);
  await page.route('**/api/smart-wallet-leaderboard', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Nansen API is not configured.' }),
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const pose = (page: Page) => page.evaluate(() => window.__teaCamera.pose());
const orbit = ({ position, target }: Pose) => {
  const [x, y, z] = position.map((v, i) => v - target[i]),
    distance = Math.hypot(x, y, z);
  return {
    azimuth: Math.atan2(x, z),
    polar: Math.acos(y / distance),
    distance,
  };
};
const gap = (a: Point, b: Point) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const inside = ({ position: [x, y, z] }: Pose, room: Room) => {
  const q = keepInRoom({ x, y, z }, room);
  return Math.hypot(q.x - x, q.y - y, q.z - z) < 1e-3;
};
/** Page pixel of a world point, only if the canvas (not UI) is under it. */
async function onCanvas(page: Page, point: Point) {
  return page.evaluate((p) => {
    const [x, y, z] = window.__teaCamera.project(p);
    const hit = z < 1 && document.elementFromPoint(x, y);
    return hit && hit.tagName === 'CANVAS' ? ([x, y] as const) : null;
  }, point);
}
async function settle(page: Page, station: string) {
  await expect(page.locator('main')).toHaveAttribute(
    'data-camera-at',
    station,
    {
      timeout: 30_000,
    },
  );
  await expect.poll(async () => (await pose(page)).moving).toBe(false);
}
async function drag(
  page: Page,
  [x, y]: readonly [number, number],
  dx: number,
  dy = 0,
) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test('free look drags, zooms and walks without leaving the room, then recenters', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await beginVisit(page);
  await settle(page, 'Counter');
  const home = await pose(page),
    base = orbit(home),
    grip = [1100, 330] as const;

  // Far past the azimuth limit: stops at the limit, stays put on release.
  await drag(page, grip, -900);
  const swung = await pose(page),
    turn = Math.abs(orbit(swung).azimuth - base.azimuth);
  expect(turn).toBeGreaterThan(0.5);
  expect(turn).toBeLessThanOrEqual(LOOK.azimuth + 0.02);
  await page.waitForTimeout(600);
  expect(gap((await pose(page)).position, swung.position)).toBeLessThan(1e-4);

  // Zoom fully out toward the side wall: the rig clamps against the room box.
  await page.mouse.move(...grip);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(200);
  const out = await pose(page);
  expect(orbit(out).distance).toBeLessThanOrEqual(
    base.distance * LOOK.zoomOut + 0.01,
  );
  expect(orbit(out).distance).toBeGreaterThan(base.distance * 1.1);
  expect(inside(out, 'waiting')).toBe(true);

  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(200);
  const near = await pose(page);
  expect(orbit(near).distance).toBeGreaterThanOrEqual(
    base.distance * LOOK.zoomIn - 0.01,
  );
  expect(inside(near, 'waiting')).toBe(true);

  // Tilt far down: the polar limit and the floor margin both hold.
  await drag(page, grip, 0, 700);
  const tilted = await pose(page);
  expect(Math.abs(orbit(tilted).polar - base.polar)).toBeLessThanOrEqual(
    LOOK.polar + 0.02,
  );
  expect(inside(tilted, 'waiting')).toBe(true);

  await page.getByRole('button', { name: 'Recenter view' }).click();
  await expect
    .poll(async () => gap((await pose(page)).position, home.position))
    .toBeLessThan(0.02);

  // Double-click open floor: walk there, keep the heading, stay in the room.
  let spot: Point | null = null,
    at: readonly [number, number] | null = null;
  for (const x of [1.2, 0.6, 1.8, 2.4])
    for (const z of [5.0, 4.5, 5.6])
      if (!at && (at = await onCanvas(page, [x, 0.01, z]))) spot = [x, 0, z];
  expect(at, 'an open floor point in view').not.toBeNull();
  await page.mouse.dblclick(at![0], at![1]);
  await expect
    .poll(async () => {
      const [x, , z] = (await pose(page)).position;
      return Math.hypot(x - spot![0], z - spot![2]);
    })
    .toBeLessThan(0.05);
  expect(inside(await pose(page), 'waiting')).toBe(true);
  await expect(page.locator('main')).toHaveAttribute('data-station', 'Counter');
});

test('halos fly to another station, open the current one, and a drag is not a click', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const hotspot = (id: string) => STATIONS.find((s) => s.id === id)!.hotspot;
  await page.goto('/');
  await beginVisit(page);
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  await nav.getByRole('button', { name: /Host/ }).click();
  await settle(page, 'AvatarSeat');
  // The seal sits in the ring. The sentence opens when the pointer is on it.
  const hostMark = await onCanvas(page, hotspot('AvatarSeat'));
  expect(hostMark, 'Host seal in view').not.toBeNull();
  await page.mouse.move(...hostMark!);
  await expect(page.locator('.halo-label')).toContainText(
    'Bring an onchain question to Nansen',
  );

  const shelfEmber = await onCanvas(page, hotspot('Shelf'));
  expect(shelfEmber, 'Shelf ember in view from the Host').not.toBeNull();
  await page.mouse.click(...shelfEmber!);
  await expect(page.locator('main')).toHaveAttribute('data-station', 'Shelf');
  await settle(page, 'Shelf');

  // A short drag that starts and ends on the shelf: the camera turns, the shelf does not open.
  const shelfBody = await onCanvas(page, [3.35, 1.1, -3.5]);
  expect(shelfBody).not.toBeNull();
  const before = await pose(page);
  await drag(page, shelfBody!, -40);
  expect(gap((await pose(page)).position, before.position)).toBeGreaterThan(
    0.05,
  );
  await page.waitForTimeout(400);
  await expect(page.locator('main')).toHaveAttribute(
    'data-shelf-view',
    'browse',
  );

  // The current station's ember opens it.
  const current = await onCanvas(page, hotspot('Shelf'));
  expect(current).not.toBeNull();
  await page.mouse.click(...current!);
  await expect(page.locator('main')).not.toHaveAttribute(
    'data-shelf-view',
    'browse',
  );

  await nav.getByRole('button', { name: /Host/ }).click();
  await settle(page, 'AvatarSeat');
  const hostEmber = await onCanvas(page, hotspot('AvatarSeat'));
  expect(hostEmber).not.toBeNull();
  await page.mouse.click(...hostEmber!);
  await expect(page.getByRole('heading', { name: 'Ask Uncle' })).toBeVisible();

  // Wheel over the open panel scrolls the panel, never the camera.
  const still = await pose(page);
  const panel = await page.locator('.reading-panel').boundingBox();
  await page.mouse.move(
    panel!.x + panel!.width / 2,
    panel!.y + panel!.height / 2,
  );
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 200);
  await page.waitForTimeout(200);
  expect(gap((await pose(page)).position, still.position)).toBeLessThan(1e-4);
});
