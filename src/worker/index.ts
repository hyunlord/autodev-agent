import type { WorkerMessage } from '../lib/worker-manager';
import { runPipeline } from './pipeline';
import { PluginRegistry } from '../lib/plugins/registry';
import { ClaudeCodeAgent } from '../lib/plugins/agents/claude-code';
import { CodexCliAgent } from '../lib/plugins/agents/codex-cli';
import { GeminiCliAgent } from '../lib/plugins/agents/gemini-cli';
import { AiderAgent } from '../lib/plugins/agents/aider';
import { ClineCliAgent } from '../lib/plugins/agents/cline-cli';
import { runMigrations } from '../lib/db/migrate';
import type { PipelineEvent } from '../lib/types';

// ─── Initialize ────────────────────────────────────────────────

// Guard against IPC channel close during HMR — prevents unhandled 'error' crash
process.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'ERR_IPC_CHANNEL_CLOSED') {
    console.warn('[Worker] IPC channel closed (HMR?) — ignoring');
    return;
  }
  console.error('[Worker] Unhandled process error:', err);
});

// Prevent worker crash on unhandled promise rejections or uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Worker] Unhandled rejection:', reason);
  // Don't exit — let active pipelines report their own errors
});

process.on('uncaughtException', (err: Error & { code?: string }) => {
  // IPC errors during HMR are expected — ignore silently
  if (err.code === 'ERR_IPC_CHANNEL_CLOSED' || err.code === 'ERR_IPC_DISCONNECTED') {
    console.warn('[Worker] IPC error in exception handler — ignoring');
    return;
  }
  console.error('[Worker] Uncaught exception:', err);
  // Don't exit — graceful degradation over crash
});

console.log('[Worker] Starting...');

// Run DB migrations on worker start
try {
  runMigrations();
  console.log('[Worker] Database migrations complete');
} catch (err) {
  console.error('[Worker] Migration error:', err);
}

// Register built-in plugins
const agents = [
  new ClaudeCodeAgent(),
  new CodexCliAgent(),
  new GeminiCliAgent(),
  new AiderAgent(),
  new ClineCliAgent(),
];
for (const agent of agents) {
  PluginRegistry.instance.registerAgent(agent);
}
console.log(`[Worker] Registered ${agents.length} agents: ${agents.map(a => a.id).join(', ')}`);

// ─── J2: Worker Pool with concurrency limit ─────────────────────

const MAX_CONCURRENT_PIPELINES = parseInt(process.env.AUTODEV_MAX_WORKERS ?? '3', 10);
const activeTasks = new Map<string, AbortController>();
const pendingQueue: Array<{ taskId: string }> = [];

function canAcceptWork(): boolean {
  return activeTasks.size < MAX_CONCURRENT_PIPELINES;
}

function processQueue(): void {
  while (pendingQueue.length > 0 && canAcceptWork()) {
    const next = pendingQueue.shift()!;
    startPipeline(next.taskId);
  }
}

function startPipeline(taskId: string): void {
  const abortController = new AbortController();
  activeTasks.set(taskId, abortController);
  console.log(`[Worker] Starting pipeline for task ${taskId} (active: ${activeTasks.size}/${MAX_CONCURRENT_PIPELINES})`);

  const emit = (event: PipelineEvent) => {
    try {
      process.send?.({ taskId, event });
    } catch {
      // IPC channel may close during HMR — swallow to prevent crash
    }
  };

  runPipeline(taskId, emit, abortController.signal)
    .catch((err) => {
      if (abortController.signal.aborted) {
        console.log(`[Worker] Task ${taskId} was cancelled`);
        emit({ type: 'task_complete', success: false, summary: 'Task cancelled by user' });
      } else {
        console.error(`[Worker] Pipeline error for task ${taskId}:`, err);
        emit({
          type: 'task_complete', success: false,
          summary: `Pipeline crashed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })
    .finally(() => {
      activeTasks.delete(taskId);
      processQueue(); // 다음 대기 작업 시작
    });
}

function getWorkerPoolStatus() {
  return {
    activeWorkers: activeTasks.size,
    maxWorkers: MAX_CONCURRENT_PIPELINES,
    pendingQueue: pendingQueue.length,
    activeTasks: [...activeTasks.keys()],
  };
}

process.on('message', async (msg: WorkerMessage) => {
  if (msg.type === 'dispatch') {
    const { taskId } = msg;

    if (activeTasks.has(taskId)) {
      console.warn(`[Worker] Task ${taskId} already running, ignoring duplicate dispatch`);
      return;
    }

    if (canAcceptWork()) {
      startPipeline(taskId);
    } else {
      pendingQueue.push({ taskId });
      console.log(`[Worker] Task ${taskId} queued (position: ${pendingQueue.length})`);
      process.send?.({
        taskId,
        event: { type: 'log', level: 'info', message: `Queued (position ${pendingQueue.length}, ${activeTasks.size}/${MAX_CONCURRENT_PIPELINES} active)` } as PipelineEvent,
      });
    }
  }

  if (msg.type === 'cancel') {
    const taskId = msg.taskId;
    // Remove from queue if pending
    const queueIdx = pendingQueue.findIndex(q => q.taskId === taskId);
    if (queueIdx >= 0) {
      pendingQueue.splice(queueIdx, 1);
      console.log(`[Worker] Task ${taskId} removed from queue`);
      return;
    }
    // Abort if active
    const controller = activeTasks.get(taskId);
    if (controller) {
      console.log(`[Worker] Cancelling task ${taskId}...`);
      controller.abort();
    } else {
      console.log(`[Worker] Task ${taskId} not found in active tasks or queue`);
    }
  }

  if ((msg as any).type === 'status') {
    process.send?.({ type: 'pool_status', ...getWorkerPoolStatus() });
  }
});

console.log('[Worker] Ready');
