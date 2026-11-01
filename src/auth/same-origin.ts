/**
 * Refuse a POST that another site could make from a visitor's browser, such
 * as a hidden form that logs the visitor in to someone else's account.
 * Browsers mark those requests with Sec-Fetch-Site. A JSON body is a second
 * lock: an HTML form cannot send one, and a cross-site fetch that sets it
 * needs a CORS preflight this app never answers.
 */
export function crossSiteError(
  request: Request,
  { json }: { json: boolean },
): Response | null {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return Response.json(
      { error: 'Requests from other sites are not allowed.' },
      { status: 403, headers: { 'cache-control': 'no-store' } },
    );
  const type = request.headers.get('content-type') ?? '';
  if (json && !/^\s*application\/json\s*(;|$)/i.test(type))
    return Response.json(
      { error: 'Send the request as JSON.' },
      { status: 415, headers: { 'cache-control': 'no-store' } },
    );
  return null;
}
