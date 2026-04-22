import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';

export class HttpPolicyError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'HttpPolicyError';
  }
}

const DEFAULT_DENY_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
];

function matchHost(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    return hostname === pattern.slice(2) || hostname.endsWith(suffix);
  }
  return hostname === pattern;
}

export function checkHost(
  url: string,
  allowedHosts: HttpNodeSpec['allowedHosts'],
): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `invalid URL: ${url}` };
  }

  const host = parsed.hostname;

  if (allowedHosts && allowedHosts.length > 0) {
    const matched = allowedHosts.some((pattern) => matchHost(host, pattern));
    if (!matched) {
      return { ok: false, reason: `host '${host}' not in allowedHosts` };
    }
    return { ok: true };
  }

  for (const pattern of DEFAULT_DENY_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `host '${host}' is blocked (private/local network)` };
    }
  }

  return { ok: true };
}
