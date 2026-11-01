import { describe, expect, it } from 'vitest';
import { crossSiteError } from '../src/auth/same-origin';

const post = (headers: Record<string, string>) =>
  new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers,
    body: '{}',
  });

describe('crossSiteError', () => {
  it('refuses requests the browser marks as coming from another site', () => {
    for (const site of ['cross-site', 'same-site']) {
      const refused = crossSiteError(
        post({ 'sec-fetch-site': site, 'content-type': 'application/json' }),
        { json: true },
      );
      expect(refused?.status).toBe(403);
    }
  });

  it('refuses a body a plain HTML form could send', () => {
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/jsonp',
    ])
      expect(
        crossSiteError(post({ 'content-type': type }), { json: true })?.status,
      ).toBe(415);
    expect(crossSiteError(post({}), { json: true })?.status).toBe(415);
  });

  it('allows same-origin JSON, and a bodyless same-origin POST', () => {
    expect(
      crossSiteError(
        post({
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json; charset=utf-8',
        }),
        { json: true },
      ),
    ).toBeNull();
    // Scripts and older browsers send no Sec-Fetch-Site.
    expect(
      crossSiteError(post({ 'content-type': 'application/json' }), {
        json: true,
      }),
    ).toBeNull();
    expect(
      crossSiteError(post({ 'sec-fetch-site': 'same-origin' }), {
        json: false,
      }),
    ).toBeNull();
  });
});
