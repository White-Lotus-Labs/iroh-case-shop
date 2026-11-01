import { expect, test } from '@playwright/test';
import { beginVisit } from './room-helpers';

test('a guest can use the room and find optional account actions', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'Entrance',
  );
  await expect(page.getByTestId('account-entry')).toBeVisible();
  await beginVisit(page);
  await page.getByRole('button', { name: 'Open the Thesis Desk' }).click({
    timeout: 20000,
  });
  await expect(
    page.getByRole('heading', { name: 'Thesis Desk' }),
  ).toBeVisible();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === 'tea_session'),
  ).toBe(false);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.getByTestId('account-entry').click();
  await expect(
    page.getByRole('heading', {
      name: 'Let Uncle remember where you left off.',
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'Entrance',
  );
});

test('register, refresh, logout, and case-insensitive login keep one identity', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const nickname = `Mark_${crypto.randomUUID().slice(0, 8)}`;
  // Waiting room covers the topbar; account UI lives on /account.
  await page.goto('/account');
  await expect(
    page.getByRole('heading', {
      name: 'Let Uncle remember where you left off.',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByLabel('Password').fill('correct horse');
  await page
    .getByRole('button', { name: 'Create my room', exact: true })
    .last()
    .click();
  await expect(page.getByTestId('account-control')).toContainText(nickname, {
    timeout: 15000,
  });
  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.user).toEqual({ id: expect.any(String), nickname });
  expect(me.user).not.toHaveProperty('passwordHash');
  const cookie = (await context.cookies()).find(
    (item) => item.name === 'tea_session',
  );
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  await page.goto('/');
  await expect(page.getByTestId('account-control')).toContainText(nickname);
  await beginVisit(page);
  await page
    .getByRole('navigation', { name: 'Tea room stations' })
    .getByRole('button', { name: /Host/ })
    .click();
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'AvatarSeat',
  );
  const logout = page.getByRole('button', { name: 'Log out' });
  await page.getByTestId('account-control').click();
  await expect(logout).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(logout).toBeHidden();
  await expect(page.getByTestId('account-control')).toBeFocused();
  await page.getByTestId('account-control').click();
  await expect(logout).toBeVisible();
  await page.locator('main').click({ position: { x: 5, y: 300 } });
  await expect(logout).toBeHidden();
  await page.getByTestId('account-control').click();
  await logout.click();
  await expect(page.getByTestId('account-entry')).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute(
    'data-station',
    'Entrance',
  );
  await page.goto('/account');
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.getByLabel('Nickname').fill(nickname.toLowerCase());
  await page.getByLabel('Password').fill('correct horse');
  await page
    .getByRole('button', { name: 'Return to my conversations' })
    .click();
  await expect(page.getByTestId('account-control')).toContainText(nickname, {
    timeout: 15000,
  });
  expect((await (await page.request.get('/api/auth/me')).json()).user.id).toBe(
    me.user.id,
  );
});

test('duplicate nickname and short password show recoverable errors', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const nickname = `Alex_${crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/account');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByLabel('Password').fill('short');
  const create = page
    .getByRole('button', { name: 'Create my room', exact: true })
    .last();
  await create.click();
  // The browser blocks a short password before any request.
  expect(
    await page
      .getByLabel('Password')
      .evaluate((el) => (el as HTMLInputElement).validity.valid),
  ).toBe(false);
  await expect(page.locator('.auth-error')).toHaveCount(0);
  await expect(page.getByLabel('Nickname')).toHaveValue(nickname);
  await page.getByLabel('Password').fill('long enough');
  await page.route('**/api/auth/register', (route) => route.abort());
  await create.click();
  await expect(page.locator('.auth-error')).toHaveText(
    'Could not reach the shop. Try again.',
  );
  await page.unroute('**/api/auth/register');
  await create.click();
  await expect(page.getByTestId('account-control')).toContainText(nickname, {
    timeout: 15000,
  });
  // Logged-in /account redirects home; waiting room covers the topbar logout.
  await page.request.post('/api/auth/logout');
  await page.goto('/account');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Nickname').fill(nickname.toLowerCase());
  await page.getByLabel('Password').fill('long enough');
  await page
    .getByRole('button', { name: 'Create my room', exact: true })
    .last()
    .click();
  await expect(page.locator('.auth-error')).toContainText('already taken');
});
