import type { WebhookOutNodeSpec, WebhookOutProvider } from '@/lib/adpl/types/nodes/webhook-out';
import type { NodeAdapter, ExecutionContext, ExecutionOptions, ValidationResult } from '../types';
import type { NodeOutput } from '@/lib/adpl/types';
import type { HttpNodeSpec } from '@/lib/adpl/types/nodes/http';
import type { WebhookSentEvent } from '../../events/types';
import { httpAdapter } from '../http';
import { acquireToken } from './rate-limiter';
import { buildSlackPayload } from './providers/slack';
import { buildDiscordPayload } from './providers/discord';
import { buildTeamsPayload } from './providers/teams';
import { buildGenericPayload } from './providers/generic';

function buildProviderPayload(
  provider: WebhookOutProvider,
  body: Record<string, unknown>,
): Record<string, unknown> {
  switch (provider) {
    case 'slack':   return buildSlackPayload(body);
    case 'discord': return buildDiscordPayload(body);
    case 'teams':   return buildTeamsPayload(body);
    case 'generic':
    default:        return buildGenericPayload(body);
  }
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export const webhookOutAdapter: NodeAdapter<WebhookOutNodeSpec> = {
  type: 'webhook_out',

  defaultTimeout(): number {
    return 30;
  },

  validate(_spec: WebhookOutNodeSpec): ValidationResult {
    return { valid: true };
  },

  async execute(
    spec: WebhookOutNodeSpec,
    ctx: ExecutionContext,
    options: ExecutionOptions,
  ): Promise<NodeOutput> {
    const provider = spec.provider ?? 'generic';
    const taskAny = ctx.$task as unknown as Record<string, unknown>;
    const runId = (taskAny?.id as string) ?? 'unknown';

    // 1. Rate limit
    await acquireToken(
      provider,
      spec.rateLimitPerMinute,
      options.eventBus,
      runId,
      options.cancellationToken,
    );

    // 2. Provider payload transformation
    const transformedBody = buildProviderPayload(provider as WebhookOutProvider, spec.body);

    // 3. Build HttpNodeSpec — extract hostname as allowedHosts so webhook URL is implicitly trusted
    const hostname = extractHostname(spec.url);
    const httpSpec: HttpNodeSpec = {
      id: spec.id,
      type: 'http',
      url: spec.url,
      method: 'POST',
      body: transformedBody,
      bodyFormat: 'json',
      retryPolicy: spec.retryPolicy ?? { maxAttempts: 2 },
      timeout: spec.timeout,
      ...(hostname ? { allowedHosts: [hostname] } : {}),
    };

    // 4. Delegate to HTTP adapter
    const result = await httpAdapter.execute(httpSpec, ctx, options);

    // 5. Emit webhook.sent
    const responseData = result.data as Record<string, unknown> | undefined;
    options.eventBus.emit({
      type: 'webhook.sent',
      provider: provider as WebhookOutProvider,
      status: (responseData?.status as number) ?? 0,
      timestamp: new Date(),
      runId,
    } as WebhookSentEvent);

    // 6. silentFail: failure doesn't stop pipeline unless failOnError
    if (result.status === 'failure' && (spec.silentFail ?? true) && !(spec.failOnError ?? false)) {
      return {
        status: 'success',
        data: {
          delivered: false,
          provider,
          error: result.error?.message,
        },
        metrics: result.metrics,
      };
    }

    return result;
  },
};
