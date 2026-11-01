import { BlockList, isIP } from 'node:net';

export const DEFAULT_AGENT_DAILY_LIMIT = 1;
const UNKNOWN_CLIENT = 'unknown-client';

export type AgentCapClaim = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

function configuredLimit(value: string | undefined) {
  if (value === undefined || value.trim() === '')
    return DEFAULT_AGENT_DAILY_LIMIT;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_AGENT_DAILY_LIMIT;
}

function utcDay(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

function nextUtcDay(now: number) {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
}

/** Process-local guard for the expensive Research Agent endpoint. */
export function createAgentDailyCap() {
  let day = '';
  let limit = -1;
  const usedByClient = new Map<string, number>();

  return {
    claim(
      clientIp: string,
      now: number = Date.now(),
      configured: string | undefined = process.env.NANSEN_AGENT_DAILY_LIMIT,
    ): AgentCapClaim {
      const currentDay = utcDay(now);
      const currentLimit = configuredLimit(configured);
      if (day !== currentDay || limit !== currentLimit) {
        day = currentDay;
        limit = currentLimit;
        usedByClient.clear();
      }

      const resetAt = nextUtcDay(now);
      const used = usedByClient.get(clientIp) ?? 0;
      const allowed = used < limit;
      const nextUsed = allowed ? used + 1 : used;
      if (allowed) usedByClient.set(clientIp, nextUsed);
      return {
        allowed,
        limit,
        remaining: Math.max(0, limit - nextUsed),
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    },
    /** Give a claim back when Nansen never answered. Never crosses a reset. */
    refund(clientIp: string, claim: AgentCapClaim, now: number = Date.now()) {
      // A new day or limit since the claim already cleared it.
      if (
        day !== utcDay(now) ||
        day !== utcDay(claim.resetAt - 1) ||
        limit !== claim.limit
      )
        return;
      const used = usedByClient.get(clientIp) ?? 0;
      if (used > 1) usedByClient.set(clientIp, used - 1);
      else usedByClient.delete(clientIp);
    },
  };
}

export const agentDailyCap = createAgentDailyCap();

/** The eight 16-bit groups of an IPv6 address; a dotted IPv4 tail is two. */
function ipv6Groups(ip: string): number[] {
  const parse = (part: string | undefined) =>
    part
      ? part.split(':').flatMap((group) => {
          if (!group.includes('.')) return [parseInt(group, 16)];
          const [a, b, c, d] = group.split('.').map(Number);
          return [(a << 8) | b, (c << 8) | d];
        })
      : [];
  const [head, tail] = ip.replace(/%.*$/, '').split('::');
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [
    ...left,
    ...Array<number>(8 - left.length - right.length).fill(0),
    ...right,
  ];
}

/** An IPv6 visitor owns a whole /64, so the cup counts the /64, not the address. */
function capKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const groups = ipv6Groups(ip);
  // An IPv4-mapped address (::ffff:a.b.c.d) is that IPv4 visitor.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return [
      groups[6] >> 8,
      groups[6] & 255,
      groups[7] >> 8,
      groups[7] & 255,
    ].join('.');
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

// Proxy hops and local traffic. A visitor on the internet never has these.
const INTERNAL_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const)
  INTERNAL_NETWORKS.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const)
  INTERNAL_NETWORKS.addSubnet(network, prefix, 'ipv6');

function isInternal(ip: string) {
  return INTERNAL_NETWORKS.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * The visitor is the right-most public x-forwarded-for entry, the one the
 * deployment proxy added. Entries to its left come from the client and can be
 * forged, so an unreadable entry stops the walk instead of skipping to them.
 * An IPv6 visitor is counted by its /64.
 */
export function clientIpFromRequest(request: Request) {
  const hops = request.headers.get('x-forwarded-for')?.split(',') ?? [];
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index].trim();
    if (!isIP(hop)) break;
    if (!isInternal(hop)) return capKey(hop);
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp && isIP(realIp) ? capKey(realIp) : UNKNOWN_CLIENT;
}
