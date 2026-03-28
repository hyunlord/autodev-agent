import { fork, type ChildProcess } from 'child_process';
import { join } from 'path';
import { EventEmitter } from 'events';
import type { PipelineEvent } from './types';

export type WorkerMessage =
  | { type: 'dispatch'; taskId: string }
  | { type: 'cancel'; taskId: string };

export type WorkerEvent = {
  taskId: string;
  event: PipelineEvent;
};

class WorkerManager extends EventEmitter {
  private worker: ChildProcess | null = null;
  private restartAttempts = 0;
  static get instance(): WorkerManager {
    const key = '__autodev_worker_manager__';
    if (!(globalThis as any)[key]) {
      (globalThis as any)[key] = new WorkerManager();
    }
    return (globalThis as any)[key];
  }

  ensureRunning(): void {
    if (this.worker && !this.worker.killed) return;
    this.spawn();
  }

  private spawn(): void {
    const workerPath = join(process.cwd(), 'src', 'worker', 'index.ts');
    this.worker = fork(workerPath, [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    this.worker.on('message', (msg: WorkerEvent) => {
      this.emit(msg.taskId, msg.event);
      this.emit('*', msg.event);
    });

    this.worker.on('exit', (code) => {
      console.error(`[WorkerManager] Worker exited with code ${code}`);
      this.worker = null;
      if (this.restartAttempts < 5) {
        this.restartAttempts++;
        setTimeout(() => this.spawn(), 3000);
      }
    });

    this.worker.on('error', (err) => {
      console.error(`[WorkerManager] Worker error:`, err);
    });

    this.restartAttempts = 0;
    console.log('[WorkerManager] Worker spawned');
  }

  dispatch(taskId: string): void {
    this.ensureRunning();
    this.worker?.send({ type: 'dispatch', taskId } satisfies WorkerMessage);
  }

  cancel(taskId: string): void {
    this.worker?.send({ type: 'cancel', taskId } satisfies WorkerMessage);
  }
}

export { WorkerManager };
