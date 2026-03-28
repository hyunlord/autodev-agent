import type { WorkerMessage } from '../lib/worker-manager';
import { runPipeline } from './pipeline';
import { PluginRegistry } from '../lib/plugins/registry';
import { ClaudeCodeAgent } from '../lib/plugins/agents/claude-code';
import { runMigrations } from '../lib/db/migrate';
import type { PipelineEvent } from '../lib/types';

// ─── Initialize ────────────────────────────────────────────────

console.log('[Worker] Starting...');

// Run DB migrations on worker start
try {
  runMigrations();
  console.log('[Worker] Database migrations complete');
} catch (err) {
  console.error('[Worker] Migration error:', err);
}

// Register built-in plugins
const claudeCode = new ClaudeCodeAgent();
PluginRegistry.instance.registerAgent(claudeCode);
console.log('[Worker] Registered agent: claude-code');

// ─── Message Handler ───────────────────────────────────────────

const activeTasks = new Set<string>();

process.on('message', async (msg: WorkerMessage) => {
  if (msg.type === 'dispatch') {
    const { taskId } = msg;

    if (activeTasks.has(taskId)) {
      console.warn(`[Worker] Task ${taskId} already running, ignoring duplicate dispatch`);
      return;
    }

    activeTasks.add(taskId);
    console.log(`[Worker] Starting pipeline for task ${taskId}`);

    const emit = (event: PipelineEvent) => {
      process.send?.({ taskId, event });
    };

    try {
      await runPipeline(taskId, emit);
    } catch (err) {
      console.error(`[Worker] Pipeline error for task ${taskId}:`, err);
      emit({
        type: 'task_complete',
        success: false,
        summary: `Pipeline crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      activeTasks.delete(taskId);
    }
  }

  if (msg.type === 'cancel') {
    console.log(`[Worker] Cancel requested for task ${msg.taskId}`);
    // TODO: implement cancellation via AbortController
  }
});

console.log('[Worker] Ready');
