import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';
import type { NodeAdapter, ExecutionContext, ExecutionOptions, ValidationResult } from '../types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { HttpRequestEvent, HttpResponseEvent, HttpRetryEvent } from '../../events/types';
import { checkHost, HttpPolicyError } from './policy';
import { buildBody } from './body-builder';
import { getMaxAttempts, shouldRetry, computeRetryDelay, isRetryableNetworkError } from './retry';
import { parseResponse } from './response-parser';
import { sleepWithCancel } from '../../worker/retry-policy';

function buildUrl(spec: HttpNodeSpec): string {
  if (!spec.queryParams || Object.keys(spec.queryParams).length === 0) {
    return spec.url;
  }
  const url = new URL(spec.url);
  for (const [key, value] of Object.entries(spec.queryParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export const httpAdapter: NodeAdapter<HttpNodeSpec> = {
  type: 'http',

  defaultTimeout(): number {
    return 30;
  },

  validate(spec: HttpNodeSpec): ValidationResult {
    // Skip validation for expression URLs (contain {{ }})
    if (spec.url.includes('{{')) return { valid: true };

    const hostCheck = checkHost(spec.url, spec.allowedHosts);
    if (!hostCheck.ok) {
      return {
        valid: false,
        errors: [{ field: 'url', message: hostCheck.reason! }],
      };
    }
    return { valid: true };
  },

  async execute(
    spec: HttpNodeSpec,
    ctx: ExecutionContext,
    options: ExecutionOptions,
  ): Promise<NodeOutput> {
    const hostCheck = checkHost(spec.url, spec.allowedHosts);
    if (!hostCheck.ok) {
      throw new HttpPolicyError(`HTTP policy blocked: ${hostCheck.reason}`, hostCheck.reason!);
    }

    const taskAny = ctx.$task as unknown as Record<string, unknown>;
    const runId = (taskAny?.id as string) ?? 'unknown';

    const startMs = Date.now();
    const url = buildUrl(spec);
    const method = spec.method ?? 'GET';
    const maxAttempts = getMaxAttempts(spec);
    const { body, headers } = buildBody(spec);

    if (spec.idempotencyKey) {
      headers.set('idempotency-key', spec.idempotencyKey);
    }

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      if (options.cancellationToken.isCancelled) {
        return {
          status: 'cancelled',
          error: {
            code: 'cancelled',
            message: 'HTTP request was cancelled',
            category: 'cancellation',
          },
        };
      }

      options.eventBus.emit({
        type: 'http.request',
        url,
        method,
        attempt,
        timestamp: new Date(),
        runId,
      } as HttpRequestEvent);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: options.cancellationToken.signal,
        });

        const durationMs = Date.now() - startMs;
        const contentLength = response.headers.get('content-length');
        options.eventBus.emit({
          type: 'http.response',
          status: response.status,
          bodySize: contentLength ? Number(contentLength) : 0,
          timestamp: new Date(),
          runId,
        } as HttpResponseEvent);

        if (shouldRetry(response, attempt, spec)) {
          const backoffMs = computeRetryDelay(response, attempt, spec);
          options.eventBus.emit({
            type: 'http.retry',
            attempt,
            reason: 'status',
            backoffMs,
            timestamp: new Date(),
            runId,
          } as HttpRetryEvent);
          await sleepWithCancel(backoffMs, options.cancellationToken);
          continue;
        }

        const data = await parseResponse(response);

        if (!response.ok) {
          return {
            status: 'failure',
            error: {
              code: `http_${response.status}`,
              message: `HTTP ${response.status} ${response.statusText}`,
              category: 'persistent',
              details: { status: response.status, body: data.body.slice(0, 500) },
            },
            data,
            metrics: { durationMs },
          };
        }

        return { status: 'success', data, metrics: { durationMs } };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return {
            status: 'cancelled',
            error: {
              code: 'cancelled',
              message: 'HTTP request was aborted',
              category: 'cancellation',
            },
          };
        }

        if (attempt < maxAttempts && isRetryableNetworkError(err)) {
          const backoffMs = computeRetryDelay(null, attempt, spec);
          options.eventBus.emit({
            type: 'http.retry',
            attempt,
            reason: 'network',
            backoffMs,
            timestamp: new Date(),
            runId,
          } as HttpRetryEvent);
          await sleepWithCancel(backoffMs, options.cancellationToken);
          continue;
        }

        throw err;
      }
    }

    // Exhausted retries with non-success status
    return {
      status: 'failure',
      error: {
        code: 'http_retries_exhausted',
        message: 'HTTP request failed after all retry attempts',
        category: 'persistent',
      },
      metrics: { durationMs: Date.now() - startMs },
    };
  },
};
