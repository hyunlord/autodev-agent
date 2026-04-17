import { db } from '@/lib/db/client';
import { webhooks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { formatMessage, type WebhookPayload } from './formatter';

const REQUEST_TIMEOUT_MS = 5000;

type WebhookRow = typeof webhooks.$inferSelect;

// Task 파이프라인 무해성 보장: 내부에서 throw 금지.
export async function dispatchWebhooks(payload: WebhookPayload): Promise<void> {
  try {
    const allHooks = db.select().from(webhooks).all();
    const matched = allHooks.filter(h =>
      h.enabled && Array.isArray(h.events) && h.events.includes(payload.event),
    );

    await Promise.allSettled(matched.map(h => sendSingle(h, payload)));
  } catch (err) {
    console.error('[webhooks] dispatch failed:', (err as Error).message);
  }
}

export async function sendSingle(hook: WebhookRow, payload: WebhookPayload): Promise<{ ok: boolean; error?: string }> {
  const body = formatMessage(payload, hook.platform);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      const msg = `HTTP ${res.status}: ${errText.slice(0, 200)}`;
      markError(hook.id, msg);
      return { ok: false, error: msg };
    }
    markSuccess(hook.id);
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    markError(hook.id, msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

function markSuccess(id: string): void {
  try {
    db.update(webhooks)
      .set({ lastTriggeredAt: new Date().toISOString(), lastError: null })
      .where(eq(webhooks.id, id))
      .run();
  } catch { /* DB 쓰기 실패는 무시 (파이프라인 무해) */ }
}

function markError(id: string, error: string): void {
  // URL 로그 출력 금지 (민감) — ID만 남김
  console.warn(`[webhooks:${id.slice(0, 8)}] ${error}`);
  try {
    db.update(webhooks)
      .set({ lastTriggeredAt: new Date().toISOString(), lastError: error })
      .where(eq(webhooks.id, id))
      .run();
  } catch { /* DB 쓰기 실패는 무시 */ }
}
