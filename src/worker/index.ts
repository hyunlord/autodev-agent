import type { WorkerMessage } from '../lib/worker-manager';

console.log('[Worker] Started');

process.on('message', async (msg: WorkerMessage) => {
  console.log('[Worker] Received:', msg.type, msg.taskId);

  if (msg.type === 'dispatch') {
    send(msg.taskId, { type: 'status_change', status: 'planning', message: 'Task received' });

    await sleep(1000);
    send(msg.taskId, { type: 'status_change', status: 'coding', message: 'Planning complete (stub)' });
    await sleep(1000);
    send(msg.taskId, { type: 'status_change', status: 'verifying', message: 'Coding complete (stub)' });
    await sleep(1000);
    send(msg.taskId, { type: 'task_complete', success: true, summary: 'Stub pipeline completed' });
  }
});

function send(taskId: string, event: any): void {
  process.send?.({ taskId, event });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
