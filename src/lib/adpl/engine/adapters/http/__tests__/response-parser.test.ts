import { describe, it, expect } from 'vitest';
import { parseResponse } from '../response-parser';

function makeResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

describe('parseResponse', () => {
  it('parses JSON body into bodyJson', async () => {
    const res = makeResponse('{"status":"ok","count":3}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const data = await parseResponse(res);
    expect(data.bodyJson).toEqual({ status: 'ok', count: 3 });
    expect(data.body).toBe('{"status":"ok","count":3}');
  });

  it('non-JSON body leaves bodyJson undefined', async () => {
    const res = makeResponse('plain text response', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const data = await parseResponse(res);
    expect(data.bodyJson).toBeUndefined();
    expect(data.body).toBe('plain text response');
  });

  it('empty body leaves bodyJson undefined', async () => {
    const res = makeResponse('', { status: 200 });
    const data = await parseResponse(res);
    expect(data.bodyJson).toBeUndefined();
    expect(data.body).toBe('');
  });

  it('broken JSON leaves bodyJson undefined (not throw)', async () => {
    const res = makeResponse('{broken json', { status: 200 });
    const data = await parseResponse(res);
    expect(data.bodyJson).toBeUndefined();
    expect(data.body).toBe('{broken json');
  });

  it('preserves status and statusText', async () => {
    const res = makeResponse('not found', { status: 404, statusText: 'Not Found' });
    const data = await parseResponse(res);
    expect(data.status).toBe(404);
    expect(data.statusText).toBe('Not Found');
  });

  it('captures response headers as plain object', async () => {
    const res = makeResponse('{}', {
      status: 200,
      headers: { 'x-request-id': 'abc123', 'content-type': 'application/json' },
    });
    const data = await parseResponse(res);
    expect(data.headers['x-request-id']).toBe('abc123');
    expect(data.headers['content-type']).toBe('application/json');
  });

  it('JSON array body is parsed correctly', async () => {
    const res = makeResponse('[1,2,3]', { status: 200 });
    const data = await parseResponse(res);
    expect(data.bodyJson).toEqual([1, 2, 3]);
  });

  it('JSON null body is parsed (bodyJson = null)', async () => {
    const res = makeResponse('null', { status: 200 });
    const data = await parseResponse(res);
    expect(data.bodyJson).toBeNull();
  });
});
