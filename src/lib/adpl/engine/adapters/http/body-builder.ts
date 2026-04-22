import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';

export interface BuiltBody {
  body: BodyInit | null;
  headers: Headers;
}

const NO_BODY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function buildFormData(data: unknown): FormData {
  const fd = new FormData();
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value instanceof Blob) {
        fd.append(key, value);
      } else {
        fd.append(key, String(value ?? ''));
      }
    }
  }
  return fd;
}

export function buildBody(spec: HttpNodeSpec): BuiltBody {
  const headers = new Headers(spec.headers ?? {});
  const method = (spec.method ?? 'GET').toUpperCase();

  if (NO_BODY_METHODS.has(method) || spec.body == null) {
    return { body: null, headers };
  }

  const format = spec.bodyFormat ?? 'json';

  switch (format) {
    case 'json':
      headers.set('content-type', 'application/json');
      return { body: JSON.stringify(spec.body), headers };

    case 'form':
      headers.set('content-type', 'application/x-www-form-urlencoded');
      return {
        body: new URLSearchParams(spec.body as Record<string, string>).toString(),
        headers,
      };

    case 'text':
      if (!headers.has('content-type')) {
        headers.set('content-type', 'text/plain');
      }
      return { body: String(spec.body), headers };

    case 'binary':
      return { body: Buffer.from(spec.body as string, 'base64'), headers };

    case 'multipart':
      // Decision 4: remove user-specified content-type so fetch sets boundary automatically
      headers.delete('content-type');
      headers.delete('Content-Type');
      return { body: buildFormData(spec.body), headers };

    default:
      headers.set('content-type', 'application/json');
      return { body: JSON.stringify(spec.body), headers };
  }
}
