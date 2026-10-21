import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { checkWebhookUrl } from '@ishan/contracts';

/**
 * SSRF guard (ADR 0012 §4). A webhook makes our server call an address a user chose, so every
 * resolved address must be public. IPv4 and IPv6 are both handled, including IPv4-mapped IPv6.
 */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function v4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
  });
}

/** Expands any valid IPv6 text form to eight 16-bit groups. */
function ipv6Groups(ip: string): number[] {
  let addr = ip.split('%')[0]!;
  const dotted = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = ipv4ToInt(dotted[1]!);
    addr =
      addr.slice(0, -dotted[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head = '', tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const missing = 8 - h.length - t.length;
  const groups = tail === undefined ? h : [...h, ...Array<string>(missing).fill('0'), ...t];
  return groups.map((g) => parseInt(g || '0', 16));
}

function v6Blocked(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  const [a, b, c, d, e, f, x, y] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (g.every((v) => v === 0)) return true; // ::
  if (g.slice(0, 7).every((v) => v === 0) && y === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible/translated forms: judge the embedded IPv4
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0)) {
    return v4Blocked(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`);
  }
  if (a === 0x64 && b === 0xff9b) return true; // NAT64 64:ff9b::/96 can reach internal v4
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x2002) return true; // 6to4: embeds an arbitrary IPv4
  return false;
}

/** `true` when the address must never be contacted. Unparseable input counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind === 6) return v6Blocked(ip);
  return true;
}

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export interface GuardOptions {
  /** Permit http://localhost / 127.0.0.1 (dev and tests only; never in production). */
  allowLocal: boolean;
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

const defaultLookup = (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true });

const isLocalHost = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';

/**
 * Validates the URL and resolves it to ONE public address that the caller must connect to
 * (pinning the address closes the DNS-rebinding window between check and connect).
 * Throws UnsafeTargetError with a Persian, user-showable reason.
 */
export async function resolveSafeTarget(raw: string, opts: GuardOptions): Promise<ResolvedTarget> {
  const problem = checkWebhookUrl(raw, opts.allowLocal);
  if (problem) throw new UnsafeTargetError(problem);
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (opts.allowLocal && isLocalHost(url.hostname)) {
    const address = host === 'localhost' || host === '127.0.0.1' ? '127.0.0.1' : '::1';
    return { url, address, family: address === '::1' ? 6 : 4 };
  }
  const literal = isIP(host);
  const addresses = literal
    ? [{ address: host, family: literal }]
    : await (opts.lookup ?? defaultLookup)(host).catch(() => {
        throw new UnsafeTargetError('نام میزبان پیدا نشد');
      });
  if (addresses.length === 0) throw new UnsafeTargetError('نام میزبان پیدا نشد');
  // One private answer taints the whole name: a split-horizon record must not slip through.
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    throw new UnsafeTargetError('آدرس به شبکه‌ی داخلی یا نامجاز اشاره می‌کند');
  }
  const first = addresses[0]!;
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}
