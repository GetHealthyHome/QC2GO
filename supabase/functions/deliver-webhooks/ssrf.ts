/**
 * Which URLs a delivery is allowed to reach.
 *
 * A webhook destination is a URL an admin typed, and this function posts to it
 * with the `service_role` key in the runtime's own network. That is the classic
 * server-side request forgery setup: the interesting targets are not on the
 * public internet at all but next to the sender — the cloud metadata endpoint
 * at 169.254.169.254 that hands out credentials, a database on 127.0.0.1, the
 * project's own internal services on a private range. A destination that
 * reaches one of those is not a webhook, it is a way to make our server fetch
 * something on the attacker's behalf and hand back what it saw.
 *
 * The column already requires `https://`, which stops `file://` and plain http.
 * This is the rest of it: the host has to be a real, public name or address.
 *
 * ## What this does and does not stop
 *
 * It blocks a literal private, loopback or link-local host, and — paired with
 * `redirect: 'manual'` at the call site — a public URL that 302s to one. What a
 * pure function cannot do is resolve a hostname to its address: a name under
 * the attacker's control that resolves to 169.254.169.254 (DNS rebinding) is
 * not caught here. Closing that needs the resolved IP checked at connect time,
 * which the delivery loop notes as the residual risk. This raises the wall from
 * "type the metadata IP" to "run a rebinding server", which is the difference
 * between a curl one-liner and an attack.
 */

/** IPv4 in the ranges no webhook has any business pointing at. */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 — "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/** IPv6 loopback, unspecified, unique-local (fc00::/7) and link-local (fe80::/10). */
function isBlockedIpv6(host: string): boolean {
  let ip = host;
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  // Drop a zone id like %eth0 before comparing.
  ip = ip.split('%')[0].toLowerCase();
  if (ip === '::1' || ip === '::') return true;
  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 hat. `new URL` normalises
  // the dotted tail to hex (::ffff:a9fe:a9fe), so accept both spellings.
  const mappedDotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]);
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const v4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    return isBlockedIpv4(v4);
  }
  const head = ip.split(':')[0];
  if (head.length === 4) {
    const value = parseInt(head, 16);
    if (value >= 0xfc00 && value <= 0xfdff) return true; // fc00::/7, unique-local
    if (value >= 0xfe80 && value <= 0xfebf) return true; // fe80::/10, link-local
  }
  return false;
}

/**
 * Whether a destination is one we refuse to deliver to.
 *
 * Returns the reason when blocked so the delivery row records *why* it was
 * refused rather than looking like an ordinary network failure the admin should
 * retry.
 */
export function blockedReason(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'the URL could not be parsed';
  }

  // Belt and braces with the column's own https check — a redirect target
  // re-validated through here has not been past that constraint.
  if (url.protocol !== 'https:') return 'only https destinations are allowed';

  const host = url.hostname.toLowerCase();
  if (host.length === 0) return 'the URL has no host';

  // A bare name with no dot is an internal short name (`localhost`, a container
  // alias, a Kubernetes service). A real webhook target is a fully qualified
  // domain or a public address.
  const looksLikeIpv6 = host.includes(':') || rawUrl.includes('[');
  if (!looksLikeIpv6 && !host.includes('.')) return 'the host is not a public name';

  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost is not reachable';
  if (host.endsWith('.internal') || host.endsWith('.local')) return 'internal hosts are not reachable';

  if (isBlockedIpv4(host)) return 'that address is on a private or reserved range';
  if (isBlockedIpv6(host)) return 'that address is on a private or reserved range';

  return null;
}
