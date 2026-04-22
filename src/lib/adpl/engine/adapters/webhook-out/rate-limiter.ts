import type { CancellationToken } from '../../cancel/token';
import type { EventBus } from '../../events/bus';
import type { WebhookRateLimitedEvent } from '../../events/types';
import { sleepWithCancel } from '../../worker/retry-policy';

interface BucketConfig {
  rpm: number;
  burst: number;
}

// Default provider limits (requests per minute + burst)
const DEFAULT_LIMITS: Record<string, BucketConfig> = {
  slack:   { rpm: 60,  burst: 5 },
  discord: { rpm: 300, burst: 10 },
  teams:   { rpm: 240, burst: 8 },
  generic: { rpm: 600, burst: 20 },
};

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly rpm: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const added = (elapsedMs / 60_000) * this.rpm;
    this.tokens = Math.min(this.burst, this.tokens + added);
    this.lastRefill = now;
  }

  tryAcquire(): { ok: boolean; waitMs: number } {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true, waitMs: 0 };
    }
    const waitMs = Math.ceil((60_000 / this.rpm));
    return { ok: false, waitMs };
  }
}

// Global in-memory buckets (singleton per process)
const buckets = new Map<string, TokenBucket>();

function getOrCreateBucket(key: string, config: BucketConfig): TokenBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = new TokenBucket(config.rpm, config.burst);
    buckets.set(key, bucket);
  }
  return bucket;
}

export async function acquireToken(
  provider: string,
  rateLimitPerMinute: number | undefined,
  eventBus: EventBus,
  runId: string,
  cancellationToken: CancellationToken,
): Promise<void> {
  const defaults = DEFAULT_LIMITS[provider] ?? DEFAULT_LIMITS['generic'];
  const rpm = rateLimitPerMinute ?? defaults.rpm;
  const key = `${provider}:${rpm}`;

  const bucket = getOrCreateBucket(key, { rpm, burst: defaults.burst });
  const result = bucket.tryAcquire();

  if (result.ok) return;

  eventBus.emit({
    type: 'webhook.rate_limited',
    provider,
    waitMs: result.waitMs,
    timestamp: new Date(),
    runId,
  } as WebhookRateLimitedEvent);

  await sleepWithCancel(result.waitMs, cancellationToken);
  return acquireToken(provider, rateLimitPerMinute, eventBus, runId, cancellationToken);
}

/** 테스트 전용: 특정 키의 버킷 초기화 */
export function resetBucket(provider: string, rateLimitPerMinute?: number): void {
  const defaults = DEFAULT_LIMITS[provider] ?? DEFAULT_LIMITS['generic'];
  const rpm = rateLimitPerMinute ?? defaults.rpm;
  buckets.delete(`${provider}:${rpm}`);
}

/** 테스트 전용: 전체 버킷 초기화 */
export function resetAllBuckets(): void {
  buckets.clear();
}
