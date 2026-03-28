export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { WorkerManager } = await import('./lib/worker-manager');
    WorkerManager.instance.ensureRunning();
  }
}
