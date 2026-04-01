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

// ─── Task tracking with AbortController ────────────────────────

const activeTasks = new Map<string, AbortController>();

process.on('message', async (msg: WorkerMessage) => {
  if (msg.type === 'dispatch') {
    const { taskId } = msg;

    if (activeTasks.has(taskId)) {
      console.warn(`[Worker] Task ${taskId} already running, ignoring duplicate dispatch`);
      return;
    }

    const abortController = new AbortController();
    activeTasks.set(taskId, abortController);
    console.log(`[Worker] Starting pipeline for task ${taskId}`);

    const emit = (event: PipelineEvent) => {
      process.send?.({ taskId, event });
    };

    try {
      await runPipeline(taskId, emit, abortController.signal);
    } catch (err) {
      if (abortController.signal.aborted) {
        console.log(`[Worker] Task ${taskId} was cancelled`);
        emit({
          type: 'task_complete',
          success: false,
          summary: 'Task cancelled by user',
        });
      } else {
        console.error(`[Worker] Pipeline error for task ${taskId}:`, err);
        emit({
          type: 'task_complete',
          success: false,
          summary: `Pipeline crashed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } finally {
      activeTasks.delete(taskId);
    }
  }

  if (msg.type === 'cancel') {
    const taskId = msg.taskId;
    const controller = activeTasks.get(taskId);
    if (controller) {
      console.log(`[Worker] Cancelling task ${taskId}...`);
      controller.abort();
    } else {
      console.log(`[Worker] Task ${taskId} not found in active tasks`);
    }
  }
});

console.log('[Worker] Ready');
