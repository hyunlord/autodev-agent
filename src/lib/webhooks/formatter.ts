export type WebhookEvent = 'completed' | 'failed' | 'low_score';

export interface WebhookPayload {
  event: WebhookEvent;
  task: {
    id: string;
    title: string;
    status: string;
    costUsd: number;
    verifyScore?: number | null;
  };
}

// Slack: { text }, Discord: { content }. 동일 text body를 필드명만 구분해 전송.
export function formatMessage(payload: WebhookPayload, platform: 'slack' | 'discord'): object {
  const { event, task } = payload;
  const emoji = event === 'completed' ? '✅' : event === 'failed' ? '❌' : '⚠️';
  const eventLabel = event === 'completed' ? 'Task Completed'
                   : event === 'failed' ? 'Task Failed'
                   : 'Low Verify Score';
  const scoreLine = task.verifyScore != null ? `\nVerify: ${task.verifyScore}/100` : '';
  const body = `${emoji} *AutoDev: ${eventLabel}*\n`
             + `${task.title}\n`
             + `Status: ${task.status}`
             + scoreLine
             + `\nCost: $${task.costUsd.toFixed(4)}`;

  if (platform === 'slack') {
    return { text: body };
  }
  // Discord markdown: *italic* → **bold**로 변환해 제목 강조
  return { content: body.replace(/\*([^*]+)\*/g, '**$1**') };
}
