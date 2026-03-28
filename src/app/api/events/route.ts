import { eventBus } from '@/lib/events/bus';
import { WorkerManager } from '@/lib/worker-manager';
import type { PipelineEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId');

  if (!taskId) {
    return new Response('Missing taskId parameter', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: PipelineEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      const workerHandler = (event: PipelineEvent) => sendEvent(event);
      WorkerManager.instance.on(taskId, workerHandler);
      eventBus.on(taskId, workerHandler);

      // Send initial heartbeat
      controller.enqueue(encoder.encode(`: heartbeat\n\n`));

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on disconnect
      req.signal.addEventListener('abort', () => {
        WorkerManager.instance.off(taskId, workerHandler);
        eventBus.off(taskId, workerHandler);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
