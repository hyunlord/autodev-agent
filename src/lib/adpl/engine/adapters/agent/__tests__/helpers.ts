import { beforeEach } from 'vitest';
import { clearCliCache } from '@/lib/cli-resolver';

export function setupCleanCli(): void {
  beforeEach(() => { clearCliCache(); });
}
