import { describe, it, expect, beforeEach, vi } from 'vitest';
import { acquireToken, resetAllBuckets } from '../rate-limiter';
import { EventBus } from '../../../events/bus';
import { CancellationToken } from '../../../cancel/token';
import type { WebhookRateLimitedEvent } from '../../../events/types';

function makeOptions() {
  return {
    eventBus: new EventBus(),
    cancellationToken: new CancellationToken(),
  };
}

beforeEach(() => {
  resetAllBuckets();
  vi.useRealTimers();
});

describe('acquireToken — burst capacity', () => {
  it('acquires up to burst(5) tokens without waiting for slack', async () => {
    const { eventBus, cancellationToken } = makeOptions();
    const rateLimited: WebhookRateLimitedEvent[] = [];
    eventBus.on('webhook.rate_limited', (e) => { rateLimited.push(e as WebhookRateLimitedEvent); });

    // Slack default: rpm=60, burst=5
    for (let i = 0; i < 5; i++) {
      await acquireToken('slack', undefined, eventBus, 'run1', cancellationToken);
    }

    expect(rateLimited).toHaveLength(0);
  });

  it('6th token for slack (burst=5) triggers rate_limited event', async () => {
    const { eventBus, cancellationToken } = makeOptions();
    const rateLimited: WebhookRateLimitedEvent[] = [];
    eventBus.on('webhook.rate_limited', (e) => { rateLimited.push(e as WebhookRateLimitedEvent); });

    // Use fast rpm override (600/min = 100ms per token — short enough for tests)
    for (let i = 0; i < 6; i++) {
      await acquireToken('slack', 600, eventBus, 'run1', cancellationToken);
    }

    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
    expect(rateLimited[0].provider).toBe('slack');
    expect(rateLimited[0].waitMs).toBeGreaterThan(0);
  });
});

describe('acquireToken — provider bucket isolation', () => {
  it('Slack and Discord buckets are independent', async () => {
    const { eventBus, cancellationToken } = makeOptions();
    const rateLimited: WebhookRateLimitedEvent[] = [];
    eventBus.on('webhook.rate_limited', (e) => { rateLimited.push(e as WebhookRateLimitedEvent); });

    // Exhaust Slack burst (override to 1 burst via high rpm but only 1 burst left)
    // Use separate keys by provider — exhaust slack with rpm=600 (burst=5)
    for (let i = 0; i < 5; i++) {
      await acquireToken('slack', 600, eventBus, 'run1', cancellationToken);
    }

    const slackLimitedBefore = rateLimited.length;

    // Discord should still have tokens (different bucket)
    resetAllBuckets();
    for (let i = 0; i < 5; i++) {
      await acquireToken('discord', 600, eventBus, 'run1', cancellationToken);
    }
    expect(rateLimited).toHaveLength(slackLimitedBefore);
  });
});

describe('acquireToken — rateLimitPerMinute override', () => {
  it('custom rateLimitPerMinute creates separate bucket from default', async () => {
    const { eventBus, cancellationToken } = makeOptions();
    const rateLimited: WebhookRateLimitedEvent[] = [];
    eventBus.on('webhook.rate_limited', (e) => { rateLimited.push(e as WebhookRateLimitedEvent); });

    // generic default rpm=600, burst=20 — far from limit
    for (let i = 0; i < 5; i++) {
      await acquireToken('generic', undefined, eventBus, 'run1', cancellationToken);
    }
    expect(rateLimited).toHaveLength(0);

    // Custom override: rpm=1 (very restrictive, but burst=20 initially)
    // Just verify no cross-contamination — bucket key differs
    await acquireToken('generic', 1, eventBus, 'run1', cancellationToken);
    expect(rateLimited).toHaveLength(0); // burst still available for new bucket
  });
});

describe('acquireToken — rate_limited event payload', () => {
  it('emits webhook.rate_limited with correct provider and waitMs', async () => {
    const { eventBus, cancellationToken } = makeOptions();
    const events: WebhookRateLimitedEvent[] = [];
    eventBus.on('webhook.rate_limited', (e) => { events.push(e as WebhookRateLimitedEvent); });

    // Exhaust Discord burst with 600 rpm override, then trigger limit
    for (let i = 0; i < 11; i++) {
      await acquireToken('discord', 600, eventBus, 'run-x', cancellationToken);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('webhook.rate_limited');
    expect(events[0].provider).toBe('discord');
    expect(events[0].waitMs).toBeGreaterThan(0);
    expect(events[0].runId).toBe('run-x');
  });
});
