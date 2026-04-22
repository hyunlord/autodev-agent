import { describe, it, expect } from 'vitest';
import { buildBody } from '../body-builder';
import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';

function spec(overrides: Partial<HttpNodeSpec>): HttpNodeSpec {
  return { id: 'test', type: 'http', url: 'https://example.com', ...overrides };
}

describe('buildBody — no body methods', () => {
  it('GET returns null body', () => {
    const { body } = buildBody(spec({ method: 'GET', body: { foo: 'bar' } }));
    expect(body).toBeNull();
  });

  it('HEAD returns null body', () => {
    const { body } = buildBody(spec({ method: 'HEAD', body: 'data' }));
    expect(body).toBeNull();
  });

  it('OPTIONS returns null body', () => {
    const { body } = buildBody(spec({ method: 'OPTIONS', body: 'data' }));
    expect(body).toBeNull();
  });

  it('null body returns null', () => {
    const { body } = buildBody(spec({ method: 'POST', body: null }));
    expect(body).toBeNull();
  });

  it('undefined body returns null', () => {
    const { body } = buildBody(spec({ method: 'POST' }));
    expect(body).toBeNull();
  });
});

describe('buildBody — json format (default)', () => {
  it('sets Content-Type application/json', () => {
    const { headers } = buildBody(spec({ method: 'POST', body: { a: 1 } }));
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('serializes body with JSON.stringify', () => {
    const data = { name: 'test', count: 42 };
    const { body } = buildBody(spec({ method: 'POST', body: data }));
    expect(body).toBe(JSON.stringify(data));
  });

  it('explicit bodyFormat json works same as default', () => {
    const { body, headers } = buildBody(
      spec({ method: 'POST', bodyFormat: 'json', body: [1, 2] }),
    );
    expect(headers.get('content-type')).toBe('application/json');
    expect(body).toBe('[1,2]');
  });
});

describe('buildBody — form format', () => {
  it('sets Content-Type application/x-www-form-urlencoded', () => {
    const { headers } = buildBody(
      spec({ method: 'POST', bodyFormat: 'form', body: { key: 'val' } }),
    );
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
  });

  it('serializes body as URLSearchParams', () => {
    const { body } = buildBody(
      spec({ method: 'POST', bodyFormat: 'form', body: { a: '1', b: '2' } }),
    );
    const params = new URLSearchParams(body as string);
    expect(params.get('a')).toBe('1');
    expect(params.get('b')).toBe('2');
  });
});

describe('buildBody — text format', () => {
  it('sets Content-Type text/plain when not specified', () => {
    const { headers } = buildBody(spec({ method: 'POST', bodyFormat: 'text', body: 'hello' }));
    expect(headers.get('content-type')).toBe('text/plain');
  });

  it('preserves user-specified content-type for text', () => {
    const { headers } = buildBody(
      spec({
        method: 'POST',
        bodyFormat: 'text',
        body: 'hello',
        headers: { 'content-type': 'text/csv' },
      }),
    );
    expect(headers.get('content-type')).toBe('text/csv');
  });

  it('converts body to string', () => {
    const { body } = buildBody(spec({ method: 'PUT', bodyFormat: 'text', body: 42 }));
    expect(body).toBe('42');
  });
});

describe('buildBody — binary format', () => {
  it('decodes base64 body to Buffer', () => {
    const original = 'hello binary';
    const b64 = Buffer.from(original).toString('base64');
    const { body } = buildBody(spec({ method: 'POST', bodyFormat: 'binary', body: b64 }));
    expect(Buffer.from(body as Buffer).toString()).toBe(original);
  });
});

describe('buildBody — multipart format', () => {
  it('returns FormData instance', () => {
    const { body } = buildBody(
      spec({ method: 'POST', bodyFormat: 'multipart', body: { file: 'content' } }),
    );
    expect(body).toBeInstanceOf(FormData);
  });

  it('removes user-specified content-type header (Decision 4)', () => {
    const { headers } = buildBody(
      spec({
        method: 'POST',
        bodyFormat: 'multipart',
        body: { key: 'val' },
        headers: { 'content-type': 'multipart/form-data; boundary=old' },
      }),
    );
    expect(headers.get('content-type')).toBeNull();
  });

  it('appends fields to FormData', () => {
    const { body } = buildBody(
      spec({
        method: 'POST',
        bodyFormat: 'multipart',
        body: { name: 'Alice', age: '30' },
      }),
    );
    const fd = body as FormData;
    expect(fd.get('name')).toBe('Alice');
    expect(fd.get('age')).toBe('30');
  });
});

describe('buildBody — user headers preserved', () => {
  it('merges spec.headers into returned headers', () => {
    const { headers } = buildBody(
      spec({
        method: 'POST',
        body: { x: 1 },
        headers: { Authorization: 'Bearer tok', 'x-custom': 'yes' },
      }),
    );
    expect(headers.get('Authorization')).toBe('Bearer tok');
    expect(headers.get('x-custom')).toBe('yes');
  });
});
