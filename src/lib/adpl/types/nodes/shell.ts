import type { NodeSpecBase, RetryPolicy } from '../common';

export type ShellOutputFormat = 'auto' | 'text' | 'json' | 'lines' | 'binary';
export type ShellMode = 'shell' | 'exec';

export interface ShellNodeSpec extends NodeSpecBase {
  type: 'shell';
  command: string; // Slot 1 표현식 가능
  args?: string[]; // exec 모드에서 사용
  mode?: ShellMode; // default: 'shell'
  cwd?: string; // default: worktree 루트
  env?: Record<string, string>; // 추가 환경 변수 (값에 Slot 1 가능)
  stdin?: string; // Slot 1 표현식 가능
  outputFormat?: ShellOutputFormat; // default: 'auto'
  failOnNonZero?: boolean; // default: true
  allowExitCodes?: number[]; // 성공으로 처리할 추가 exit codes
  idempotencyKey?: string;
}
