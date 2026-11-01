import { expect, type Page } from '@playwright/test';

export async function registerBrowserAccount(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      nickname: `Test_${crypto.randomUUID().slice(0, 12)}`,
      password: 'browser test password',
    },
  });
  expect(response.status()).toBe(201);
}
