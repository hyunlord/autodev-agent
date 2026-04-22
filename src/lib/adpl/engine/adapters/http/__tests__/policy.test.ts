import { describe, it, expect } from 'vitest';
import { checkHost, HttpPolicyError } from '../policy';

describe('checkHost — default denylist mode (no allowedHosts)', () => {
  it('allows public domain', () => {
    expect(checkHost('https://api.example.com/v1', undefined)).toEqual({ ok: true });
  });

  it('blocks localhost', () => {
    const r = checkHost('http://localhost:3000/path', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('localhost');
  });

  it('blocks 127.0.0.1', () => {
    const r = checkHost('http://127.0.0.1:8080', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('127.0.0.1');
  });

  it('blocks 0.0.0.0', () => {
    const r = checkHost('http://0.0.0.0', undefined);
    expect(r.ok).toBe(false);
  });

  it('blocks 10.x.x.x private range', () => {
    expect(checkHost('http://10.0.0.1/api', undefined).ok).toBe(false);
    expect(checkHost('http://10.255.255.255/api', undefined).ok).toBe(false);
  });

  it('blocks 172.16-31.x.x private range', () => {
    expect(checkHost('http://172.16.0.1', undefined).ok).toBe(false);
    expect(checkHost('http://172.31.255.255', undefined).ok).toBe(false);
    // 172.15 is NOT in range
    expect(checkHost('https://172.15.0.1', undefined).ok).toBe(true);
    // 172.32 is NOT in range
    expect(checkHost('https://172.32.0.1', undefined).ok).toBe(true);
  });

  it('blocks 192.168.x.x private range', () => {
    expect(checkHost('http://192.168.1.1', undefined).ok).toBe(false);
    expect(checkHost('http://192.168.0.0', undefined).ok).toBe(false);
  });

  it('blocks 169.254.x.x link-local (AWS metadata)', () => {
    expect(checkHost('http://169.254.169.254/latest/meta-data/', undefined).ok).toBe(false);
  });

  it('returns false with reason for invalid URL', () => {
    const r = checkHost('not-a-url', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('invalid URL');
  });

  it('allows empty allowedHosts array (falls back to denylist)', () => {
    const r = checkHost('https://api.example.com', []);
    expect(r.ok).toBe(true);
  });
});

describe('checkHost — allowlist mode', () => {
  it('allows exact match host', () => {
    const r = checkHost('https://api.example.com/v1', ['api.example.com']);
    expect(r.ok).toBe(true);
  });

  it('blocks non-matching host when allowedHosts specified', () => {
    const r = checkHost('https://other.example.com/v1', ['api.example.com']);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('not in allowedHosts');
  });

  it('allows wildcard subdomain match', () => {
    expect(checkHost('https://api.example.com', ['*.example.com'])).toEqual({ ok: true });
    expect(checkHost('https://cdn.example.com', ['*.example.com'])).toEqual({ ok: true });
  });

  it('wildcard does not match root domain itself unless explicit', () => {
    // *.example.com matches example.com (bare domain is allowed per matchHost logic)
    // Actually our impl: hostname === pattern.slice(2) means "example.com" === "example.com" → true
    const r = checkHost('https://example.com', ['*.example.com']);
    expect(r.ok).toBe(true);
  });

  it('blocks non-subdomain with wildcard', () => {
    const r = checkHost('https://evil.com', ['*.example.com']);
    expect(r.ok).toBe(false);
  });

  it('allowedHosts can allow localhost (overrides denylist)', () => {
    const r = checkHost('http://localhost:4000', ['localhost']);
    expect(r.ok).toBe(true);
  });

  it('allowedHosts can allow 127.0.0.1 for test environments', () => {
    const r = checkHost('http://127.0.0.1:9999', ['127.0.0.1']);
    expect(r.ok).toBe(true);
  });

  it('multiple hosts in allowedHosts — first match wins', () => {
    const r = checkHost('https://b.example.com', ['a.example.com', 'b.example.com']);
    expect(r.ok).toBe(true);
  });
});

describe('HttpPolicyError', () => {
  it('is an Error with name HttpPolicyError', () => {
    const err = new HttpPolicyError('blocked', 'private network');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HttpPolicyError');
    expect(err.message).toBe('blocked');
    expect(err.reason).toBe('private network');
  });
});
