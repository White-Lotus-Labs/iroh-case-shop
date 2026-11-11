import {
  INDEXER_PAGE_SIZE,
  indexerAccount,
  indexerCursor,
  parseIndexedPage,
} from '../../../case/indexer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 256_000;
const headers = { 'Cache-Control': 'no-store' };

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > MAX_BODY_BYTES)
    throw new Error('Oversized indexer response.');
  if (!response.body) throw new Error('Missing indexer response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('Oversized indexer response.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function GET(request: Request) {
  let account: string, cursor: string | null;
  try {
    const params = new URL(request.url).searchParams;
    account = indexerAccount(params.get('account'));
    cursor = indexerCursor(params.get('cursor'));
  } catch {
    return Response.json(
      { error: 'Use a valid .testnet account and history cursor.' },
      { status: 400, headers },
    );
  }
  const url = new URL(
    `https://api-testnet.nearblocks.io/v3/accounts/${account}/txns`,
  );
  url.searchParams.set('limit', String(INDEXER_PAGE_SIZE));
  if (cursor) url.searchParams.set('next', cursor);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
      headers: { Accept: 'application/json' },
    });
    if (response.status === 429)
      return Response.json(
        { error: 'History indexer rate limit reached. Retry later.' },
        { status: 429, headers: { ...headers, 'Retry-After': '30' } },
      );
    if (!response.ok) throw new Error('History indexer is unavailable.');
    const page = parseIndexedPage(await boundedJson(response), account);
    // A repeating upstream cursor must not trigger an endless Load more loop.
    if (cursor && cursor === page.nextCursor)
      throw new Error('Repeating indexer cursor.');
    return Response.json(page, { headers });
  } catch {
    return Response.json(
      {
        error:
          'History indexer is unavailable. Existing verified history is unaffected.',
      },
      { status: 502, headers },
    );
  }
}
