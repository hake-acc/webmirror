import * as dns from 'dns';
import * as net from 'net';

export class SsrfGuard {
  // Disallowed loopback/private IPv4 blocks
  private static readonly PRIVATE_IPV4_RANGES = [
    { start: '0.0.0.0', end: '0.255.255.255' },
    { start: '10.0.0.0', end: '10.255.255.255' },
    { start: '127.0.0.0', end: '127.255.255.255' },
    { start: '169.254.0.0', end: '169.254.255.255' }, // Cloud metadata (169.254.169.254)
    { start: '172.16.0.0', end: '172.31.255.255' },
    { start: '192.168.0.0', end: '192.168.255.255' },
    { start: '100.64.0.0', end: '100.127.255.255' },
    { start: '198.18.0.0', end: '198.19.255.255' },
    { start: '224.0.0.0', end: '239.255.255.255' },
    { start: '240.0.0.0', end: '255.255.255.255' },
  ];

  private static ipToLong(ip: string): number {
    return ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  private static isPrivateIpv4(ip: string): boolean {
    const ipLong = this.ipToLong(ip);
    for (const range of this.PRIVATE_IPV4_RANGES) {
      const startLong = this.ipToLong(range.start);
      const endLong = this.ipToLong(range.end);
      if (ipLong >= startLong && ipLong <= endLong) {
        return true;
      }
    }
    return false;
  }

  private static isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fe90:') || normalized.startsWith('fea0:') || normalized.startsWith('feb0:')) {
      return true; // link-local
    }
    if (normalized.startsWith('fc00:') || normalized.startsWith('fd00:')) {
      return true; // unique local address
    }
    return false;
  }

  /**
   * Validates if a target URL is safe to fetch or crawl.
   * Throws an Error with a descriptive security message if unsafe.
   */
  public static async validateUrl(urlString: string, allowedOrigins?: Set<string>): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new Error(`Invalid URL format: "${urlString}"`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check common local domain indicators
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === 'metadata.google.internal' ||
      hostname === '169.254.169.254'
    ) {
      throw new Error(`Access to local or internal host "${hostname}" is blocked for security.`);
    }

    // Resolve IP address and verify it's public
    try {
      const addresses = await dns.promises.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        throw new Error(`Failed to resolve DNS for "${hostname}"`);
      }

      for (const entry of addresses) {
        if (net.isIPv4(entry.address)) {
          if (this.isPrivateIpv4(entry.address)) {
            throw new Error(`Hostname "${hostname}" resolves to private IP "${entry.address}", which is blocked.`);
          }
        } else if (net.isIPv6(entry.address)) {
          if (this.isPrivateIpv6(entry.address)) {
            throw new Error(`Hostname "${hostname}" resolves to private IPv6 "${entry.address}", which is blocked.`);
          }
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes('blocked')) {
        throw err;
      }
      throw new Error(`DNS lookup failed for "${hostname}": ${err.message}`);
    }

    // If allowed origins are supplied, verify origin boundary
    if (allowedOrigins && allowedOrigins.size > 0) {
      if (!allowedOrigins.has(parsed.origin)) {
        throw new Error(`Cross-origin navigation to "${parsed.origin}" is restricted by crawler boundaries.`);
      }
    }

    return parsed;
  }
}
