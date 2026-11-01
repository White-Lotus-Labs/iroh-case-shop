import { expect, test } from '@playwright/test';
import { registerBrowserAccount } from './auth-helper';
import { beginVisit, openStationPanel } from './room-helpers';

test.beforeEach(async ({ page }) => registerBrowserAccount(page));

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/smart-wallet-leaderboard', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Nansen API is not configured.' }),
    }),
  );
});

test('Host restores previous chats after reload and switches between them', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const chats = [
    {
      id: 'eth-chat',
      title: 'ETH activity',
      updatedAt: '2026-09-26T08:00:00.000Z',
    },
    {
      id: 'sol-chat',
      title: 'SOL activity',
      updatedAt: '2026-09-25T08:00:00.000Z',
    },
  ];
  const saved = {
    'eth-chat': {
      id: 'eth-chat',
      nansenConversationId: 'conv_eth',
      messages: [
        {
          id: 1,
          role: 'user',
          content: 'What is ETH doing?',
          status: 'complete',
        },
        {
          id: 2,
          role: 'assistant',
          content: 'ETH has inflows.',
          status: 'complete',
        },
      ],
    },
    'sol-chat': {
      id: 'sol-chat',
      nansenConversationId: null,
      messages: [
        {
          id: 3,
          role: 'user',
          content: 'What is SOL doing?',
          status: 'complete',
        },
        {
          id: 4,
          role: 'assistant',
          content: 'SOL has outflows.',
          status: 'complete',
        },
      ],
    },
  };
  await page.route('**/api/iroh/chats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ chats }),
    });
  });
  await page.route('**/api/iroh/chats/*', async (route) => {
    const id = route.request().url().split('/').at(-1) as keyof typeof saved;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ chat: saved[id] }),
    });
  });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/nansen-agent', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"delta","text":"Seven-day ETH answer"}\n\ndata: {"type":"finish","conversation_id":"conv_eth_2"}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto('/');
  await openStationPanel(page, 'Host');
  await expect(page.getByText('ETH has inflows.')).toBeVisible();
  const historyToggle = page.getByRole('button', { name: 'Chat history' });
  await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(
    page.getByRole('complementary', { name: 'Chat history' }),
  ).toHaveCount(0);
  await historyToggle.click();
  await expect(
    page.getByRole('button', { name: 'Hide history' }),
  ).toHaveAttribute('aria-expanded', 'true');
  const history = page.getByRole('complementary', { name: 'Chat history' });
  await history.getByRole('button', { name: 'SOL activity' }).click();
  await expect(page.getByText('SOL has outflows.')).toBeVisible();
  await page.getByRole('button', { name: 'Hide history' }).click();
  await expect(history).toHaveCount(0);
  await page.getByRole('button', { name: 'Chat history' }).click();
  await history.getByRole('button', { name: 'ETH activity' }).click();
  await expect(page.getByText('ETH has inflows.')).toBeVisible();
  await page.reload();
  await openStationPanel(page, 'Host');
  await expect(page.getByText('ETH has inflows.')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Ask an onchain research question' })
    .fill('How about seven days?');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(page.getByText('Seven-day ETH answer')).toBeVisible();
  expect(requests).toEqual([
    { text: 'How about seven days?', chatId: 'eth-chat' },
  ]);
});

test('Host immediately shows Iroh chat in the Host panel, keeps history across stations, and resets conversation', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/nansen-agent', async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    const id = bodies.length === 1 ? 'conv_1' : 'conv_2';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: {"type":"tool_call","name":"holdings"}\n\ndata: {"type":"delta","text":"Nansen answer ${bodies.length}"}\n\ndata: {"type":"finish","conversation_id":"${id}"}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto('/');
  await openStationPanel(page, 'Host');
  await expect(page.getByRole('heading', { name: 'Ask Uncle' })).toBeVisible();
  await expect(page.getByText(/One breath before you go/)).toHaveCount(0);
  await expect(page.locator('.status-line')).toBeHidden();
  await expect(page.locator('main')).toHaveAttribute(
    'data-camera-at',
    'AvatarSeat',
    { timeout: 7000 },
  );
  const panel = await page.locator('.reading-panel').boundingBox();
  expect(panel!.width).toBeGreaterThan(
    (page.viewportSize()?.width ?? 1280) * 0.4,
  );
  const input = page.getByRole('textbox', {
    name: 'Ask an onchain research question',
  });
  await input.fill('What is ETH doing?');
  await input.press('Shift+Enter');
  await input.type('And why?');
  await expect(input).toHaveValue('What is ETH doing?\nAnd why?');
  await input.press('Enter');
  await expect(page.getByText('Nansen answer 1')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Tea room stations' });
  await nav.getByRole('button', { name: /Shelf/ }).click();
  await nav.getByRole('button', { name: /Host/ }).click();
  await page
    .getByRole('button', { name: 'Ask Uncle', exact: true })
    .click({ timeout: 20000 });
  await expect(page.getByText('Nansen answer 1')).toBeVisible();
  await input.fill('What about HYPE?');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(page.getByText('Nansen answer 2')).toBeVisible();
  expect(bodies[0]).toMatchObject({ text: 'What is ETH doing?\nAnd why?' });
  expect(bodies[1]).toEqual({
    text: 'What about HYPE?',
    chatId: bodies[0].chatId,
  });
  await page.getByRole('button', { name: 'Begin a new conversation' }).click();
  await expect(page.getByText('Nansen answer 1')).not.toBeVisible();
  await input.fill('Fresh question');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  expect(bodies[2]).toMatchObject({ text: 'Fresh question' });
  expect(bodies[2].chatId).not.toBe(bodies[0].chatId);
  await expect(
    page.getByRole('button', { name: 'Close Uncle chat' }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Iroh shows a live provider error and Stop ends a pending request', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/nansen-agent', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Nansen Research Agent is not configured.',
      }),
    });
  });
  await page.goto('/');
  await openStationPanel(page, 'Host');
  const input = page.getByRole('textbox', {
    name: 'Ask an onchain research question',
  });
  await input.fill('Is anyone buying ETH?');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(page.locator('.iroh-error')).toContainText('not configured');
  await expect(page.getByText(/Nansen answer/)).toHaveCount(0);

  let release!: () => void;
  await page.unroute('**/api/nansen-agent');
  await page.route('**/api/nansen-agent', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"finish","conversation_id":"late"}\n\ndata: [DONE]\n\n',
      })
      .catch(() => {});
  });
  await input.fill('A different question');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Stop generation' }),
  ).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: 'Stop generation' }).click();
  release();
  await expect(page.getByText('Stopped · partial answer')).toBeVisible();
  await expect(input).toBeEnabled();
  await page.getByRole('button', { name: 'Begin a new conversation' }).click();
  await expect(page.getByText('Is anyone buying ETH?')).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('Iroh offers BYOK after the daily cup and sends the visitor key', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Configured Nansen renders 'Try again' on other errors, so the count-0
  // check below guards the daily-cap branch.
  await page.route('**/api/nansen-status', (route) =>
    route.fulfill({ json: { nansen: 'configured' } }),
  );
  let sawUserKeyHeader = false;
  await page.route('**/api/nansen-agent', async (route) => {
    const header = route.request().headers()['x-user-nansen-api-key'];
    if (header === 'visitor-byok-key') {
      sawUserKeyHeader = true;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"delta","text":"BYOK answer"}\n\ndata: {"type":"finish","conversation_id":"conv_byok"}\n\ndata: [DONE]\n\n',
      });
      return;
    }
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error:
          'One cup for today, my friend. If you’d like to keep exploring, Nansen has more research waiting for you.',
        code: 'nansen_agent_daily_limit',
      }),
    });
  });
  await page.goto('/');
  await openStationPanel(page, 'Host');
  await page
    .getByRole('textbox', { name: 'Ask an onchain research question' })
    .fill('One more question');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();

  await expect(page.locator('.iroh-error')).toContainText(
    'One cup for today, my friend. If you’d like to keep exploring, Nansen has more research waiting for you.',
  );
  const cta = page.getByRole('link', { name: /Get a Nansen API key/ });
  await expect(cta).toHaveAttribute('href', 'https://nsn.ai/iroh0x');
  await expect(cta).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  const composer = page.getByRole('textbox', {
    name: 'Ask an onchain research question',
  });
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveAttribute(
    'placeholder',
    'Daily limit reached. Enter your key to continue.',
  );

  await page.getByRole('button', { name: 'Enter your key' }).click();
  await page
    .getByPlaceholder('Paste your Nansen API key')
    .fill('visitor-byok-key');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Using your Nansen key')).toBeVisible();
  await expect(composer).toBeEnabled();

  await composer.fill('Ask with my key');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(page.getByText('BYOK answer')).toBeVisible();
  expect(sawUserKeyHeader).toBe(true);
});

test('Iroh keeps a completed answer when Nansen returns no conversation ID', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route('**/api/nansen-agent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"delta","text":"Complete answer"}\n\ndata: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto('/');
  await openStationPanel(page, 'Host');
  await page
    .getByRole('textbox', { name: 'Ask an onchain research question' })
    .fill('What is ETH doing?');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(page.getByText('Complete answer')).toBeVisible();
  await expect(page.locator('.iroh-error')).toHaveCount(0);
});

test('Iroh keeps follow-ups in the same saved chat without a conversation ID', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const requests: {
    text: string;
    chatId?: string;
    conversation_id?: string;
  }[] = [];
  await page.route('**/api/nansen-agent', async (route) => {
    requests.push(route.request().postDataJSON());
    const answer =
      requests.length === 1
        ? 'ETH Smart Trader wallets had net outflow over 24 hours.'
        : 'Here is the seven-day ETH comparison.';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'delta', text: answer })}\n\ndata: {"type":"finish","conversation_id":null}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto('/');
  await openStationPanel(page, 'Host');
  const input = page.getByRole('textbox', {
    name: 'Ask an onchain research question',
  });
  await input.fill(
    'What is smart money doing with ETH on Ethereum over the last 24 hours?',
  );
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(
    page.getByText('ETH Smart Trader wallets had net outflow over 24 hours.'),
  ).toBeVisible();
  await input.fill('How does that compare with the last 7 days?');
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(
    page.getByText('Here is the seven-day ETH comparison.'),
  ).toBeVisible();
  expect(requests[1].text).toBe('How does that compare with the last 7 days?');
  expect(requests[1].chatId).toBe(requests[0].chatId);
  expect(requests[1].conversation_id).toBeUndefined();
});

test('the Uncle hand-off prefill is used once, not on every reopen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await openStationPanel(page, 'Counter');
  await page
    .getByRole('button', { name: 'Ask Uncle about your own thesis' })
    .click();
  const composer = page.getByRole('textbox', {
    name: 'Ask an onchain research question',
  });
  await expect(composer).toHaveValue('Uncle, test my thesis: ');
  await composer.fill('');
  await page.getByRole('button', { name: 'Close Host menu' }).click();
  await page.getByRole('button', { name: 'Ask Uncle', exact: true }).click();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
});
