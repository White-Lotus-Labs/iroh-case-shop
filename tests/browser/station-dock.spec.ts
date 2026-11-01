import { test, expect } from '@playwright/test';
import { beginVisit } from './room-helpers';

// Headless WebGL renders slowly, so animation frames arrive late.
const slow = { timeout: 30000 };

test('station dock magnifies under the pointer and keeps navigation', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await beginVisit(page);
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  const host = nav.getByRole('button', { name: /Host/ });
  const width = async () => (await host.boundingBox())!.width;
  const rest = await width();

  const box = (await host.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(width, slow).toBeGreaterThan(rest + 10);

  await host.click();
  await expect(host).toHaveAttribute('aria-current', 'step');
  await page.mouse.move(0, 0);
  await expect.poll(width, slow).toBeLessThan(rest + 0.5);
});
