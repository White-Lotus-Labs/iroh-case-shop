import { describe, expect, it } from 'vitest';
import {
  clientIpFromRequest,
  createAgentDailyCap,
  DEFAULT_AGENT_DAILY_LIMIT,
} from '../src/nansen/agent-cap';

describe('Nansen Research Agent daily cap', () => {
  it('defaults to one call per IP', () => {
    expect(DEFAULT_AGENT_DAILY_LIMIT).toBe(1);
  });

  it('rejects calls after the limit and resets at midnight UTC', () => {
    const cap = createAgentDailyCap();
    const beforeMidnight = Date.UTC(2026, 8, 27, 23, 59, 59);

    expect(cap.claim('203.0.113.10', beforeMidnight, '1')).toMatchObject({
      allowed: true,
      limit: 1,
      remaining: 0,
    });
    expect(cap.claim('203.0.113.10', beforeMidnight, '1')).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });
    expect(
      cap.claim('203.0.113.10', beforeMidnight + 1_000, '1'),
    ).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it('tracks each IP independently', () => {
    const cap = createAgentDailyCap();
    const now = Date.UTC(2026, 8, 27, 12);

    expect(cap.claim('203.0.113.10', now, '1').allowed).toBe(true);
    expect(cap.claim('203.0.113.10', now, '1').allowed).toBe(false);
    expect(cap.claim('203.0.113.11', now, '1')).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it('allows zero to turn the Research Agent off', () => {
    expect(
      createAgentDailyCap().claim('203.0.113.10', Date.now(), '0').allowed,
    ).toBe(false);
  });

  it('refunds a claim within the same UTC day only', () => {
    const cap = createAgentDailyCap();
    const now = Date.UTC(2026, 8, 27, 23, 59, 59);

    const first = cap.claim('203.0.113.10', now, '1');
    expect(first.allowed).toBe(true);
    cap.refund('203.0.113.10', first, now);
    cap.refund('203.0.113.10', first, now);
    const second = cap.claim('203.0.113.10', now, '1');
    expect(second.allowed).toBe(true);
    expect(cap.claim('203.0.113.10', now, '1').allowed).toBe(false);
    cap.refund('203.0.113.10', second, now + 2_000);
    expect(cap.claim('203.0.113.10', now, '1').allowed).toBe(false);
  });

  it('does not refund a claim from before a reset', () => {
    const cap = createAgentDailyCap();
    const now = Date.UTC(2026, 8, 27, 23, 59, 50);
    const late = cap.claim('203.0.113.10', now, '1');
    const tomorrow = now + 20_000;
    expect(cap.claim('203.0.113.10', tomorrow, '1').allowed).toBe(true);
    cap.refund('203.0.113.10', late, tomorrow + 10_000);
    expect(cap.claim('203.0.113.10', tomorrow, '1').allowed).toBe(false);
  });

  const ipFrom = (headers: Record<string, string>) =>
    clientIpFromRequest(new Request('http://localhost', { headers }));

  it('takes the proxy-added forwarded IP and skips internal hops after it', () => {
    expect(ipFrom({ 'x-forwarded-for': '203.0.113.10' })).toBe('203.0.113.10');
    expect(ipFrom({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' })).toBe(
      '203.0.113.10',
    );
    expect(
      ipFrom({
        'x-forwarded-for': '2001:db8::5, 100.64.0.2, fd12::1, 127.0.0.1, ::1',
      }),
    ).toBe('2001:db8:0:0::/64');
  });

  it('ignores a forged left-most forwarded IP', () => {
    expect(ipFrom({ 'x-forwarded-for': '198.51.100.7, 203.0.113.10' })).toBe(
      '203.0.113.10',
    );
    expect(
      ipFrom({
        'x-forwarded-for': '198.51.100.7, 198.51.100.8, 203.0.113.10, 10.0.0.1',
        'x-real-ip': '203.0.113.10',
      }),
    ).toBe('203.0.113.10');
  });

  it('never reads past an unreadable hop into client-supplied entries', () => {
    expect(ipFrom({ 'x-forwarded-for': '198.51.100.7, not-an-ip' })).toBe(
      'unknown-client',
    );
    expect(
      ipFrom({ 'x-forwarded-for': '198.51.100.7, 203.0.113.10:443' }),
    ).toBe('unknown-client');
  });

  it('falls back to x-real-ip, then to one shared unknown bucket', () => {
    expect(
      ipFrom({ 'x-forwarded-for': 'not-an-ip', 'x-real-ip': '2001:db8::1' }),
    ).toBe('2001:db8:0:0::/64');
    expect(
      ipFrom({ 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '203.0.113.12' }),
    ).toBe('203.0.113.12');
    expect(ipFrom({ 'x-forwarded-for': '::1' })).toBe('unknown-client');
    expect(ipFrom({ 'x-real-ip': 'garbage' })).toBe('unknown-client');
    expect(ipFrom({})).toBe('unknown-client');
  });

  it('counts an IPv6 visitor by /64 and an IPv4-mapped address as IPv4', () => {
    const ip = (value: string) => ipFrom({ 'x-forwarded-for': value });
    expect(ip('2001:db8:0:1::1')).toBe('2001:db8:0:1::/64');
    expect(ip('2001:0db8:0000:0001:ffff:ffff:ffff:ffff')).toBe(
      '2001:db8:0:1::/64',
    );
    expect(ip('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ip('::ffff:203.0.113.10')).toBe('203.0.113.10');
    // Groups written after '::' still count toward the /64.
    expect(ip('2a01::5:1:2:3:4')).toBe('2a01:0:0:5::/64');
    expect(ip('2a01:0:0:5::1')).toBe('2a01:0:0:5::/64');
    expect(ip('2001:db8::1:2:3:4:5')).toBe('2001:db8:0:1::/64');
    expect(ip('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(ip('0:0:0:0:0:ffff:1.2.3.4')).toBe('1.2.3.4');
    // The fallback header is keyed the same way.
    expect(ipFrom({ 'x-real-ip': '2a01::5:1:2:3:4' })).toBe('2a01:0:0:5::/64');
  });
});
