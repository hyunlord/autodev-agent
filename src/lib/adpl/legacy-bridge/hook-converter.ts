import type { ShellNodeSpec } from '@/lib/adpl/types/nodes/shell';
import { mapEventToPlacement } from './phase-mapper';

export interface LegacyHookEntry {
  event: string;
  type: 'command' | 'script' | 'agent' | 'http';
  name?: string;
  /** command type: 실행할 셸 명령 */
  command?: string;
  /** script type: 스크립트 파일 경로 */
  path?: string;
  /** script type: 인라인 스크립트 내용 (path보다 우선) */
  script?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  failAction?: 'ignore' | 'warn' | 'retry' | 'replan' | 'fail';
  blocking?: boolean;
  [key: string]: unknown;
}

export type LegacyHookConfig = LegacyHookEntry[];

export interface ConvertResult {
  /** 성공적으로 변환된 shell 노드 배열 */
  nodes: ShellNodeSpec[];
  /** 스킵된 hook 목록 (agent/http type) */
  skipped: Array<{ event: string; type: 'agent' | 'http'; reason: string }>;
  /** 변환 중 발생한 경고 */
  warnings: string[];
}

// ShellNodeSpec에 직접 매핑되는 알려진 필드 집합
const KNOWN_FIELDS = new Set<string>([
  'event', 'type', 'name', 'command', 'path', 'script',
  'cwd', 'env', 'timeout', 'failAction', 'blocking',
]);

/** PascalCase/camelCase 이벤트명 → kebab-case id */
function toKebabCase(eventName: string): string {
  return eventName
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

/**
 * legacy HookEngine 설정을 ADPL shell 노드 배열로 변환.
 * agent/http type은 건너뜀 + skipped 배열에 기록.
 * 동일 이벤트 중복 시 id에 -0, -1 접미사로 disambiguation.
 */
export function convertLegacyHooks(config: LegacyHookConfig): ConvertResult {
  const nodes: ShellNodeSpec[] = [];
  const skipped: ConvertResult['skipped'] = [];
  const warnings: string[] = [];

  // 1pass: 이벤트별 command/script 항목 수 집계 (disambiguation용)
  const idCounts: Record<string, number> = {};
  for (const hook of config) {
    if (hook.type === 'agent' || hook.type === 'http') continue;
    const baseId = toKebabCase(hook.event);
    idCounts[baseId] = (idCounts[baseId] ?? 0) + 1;
  }

  const idSeen: Record<string, number> = {};

  for (const hook of config) {
    // agent/http: skip + 기록
    if (hook.type === 'agent' || hook.type === 'http') {
      skipped.push({
        event: hook.event,
        type: hook.type,
        reason: `${hook.type} type hooks require a dedicated adapter; handle after the ${hook.type} adapter is implemented`,
      });
      continue;
    }

    // 이벤트 → 배치 매핑
    const placement = mapEventToPlacement(hook.event);
    if (placement === null) {
      warnings.push(`Hook '${hook.event}': unknown event, cannot determine ADPL placement — skipping`);
      continue;
    }

    // 알 수 없는 필드 경고
    for (const key of Object.keys(hook)) {
      if (!KNOWN_FIELDS.has(key)) {
        warnings.push(`Hook '${hook.event}': unknown option '${key}' will be ignored`);
      }
    }

    // blocking: false 경고 (ADPL v1 shell 노드는 동기 실행만 지원)
    if (hook.blocking === false) {
      warnings.push(`Hook '${hook.event}': blocking: false is not supported in ADPL v1 shell nodes; hook will run synchronously`);
    }

    // 직접 매핑 없는 failAction 경고
    if (hook.failAction === 'retry' || hook.failAction === 'replan') {
      warnings.push(`Hook '${hook.event}': failAction '${hook.failAction}' has no ShellNodeSpec equivalent; defaulting to failOnNonZero: true`);
    }

    // command 결정
    let command: string | undefined;
    if (hook.type === 'command') {
      command = hook.command;
    } else {
      // script type: inline(script) 우선, 없으면 path
      command = hook.script ?? hook.path;
    }

    if (!command) {
      warnings.push(`Hook '${hook.event}': ${hook.type} type has no command/script/path — skipping`);
      continue;
    }

    // id 결정 (중복 시 -0, -1 접미사)
    const baseId = toKebabCase(hook.event);
    let finalId: string;
    if (idCounts[baseId] > 1) {
      const idx = idSeen[baseId] ?? 0;
      finalId = `${baseId}-${idx}`;
      idSeen[baseId] = idx + 1;
    } else {
      finalId = baseId;
    }

    // ShellNodeSpec 구성
    const node: ShellNodeSpec = {
      id: finalId,
      type: 'shell',
      mode: 'shell',
      command,
    };

    if (hook.cwd !== undefined) node.cwd = hook.cwd;
    if (hook.env !== undefined) node.env = hook.env;
    if (hook.timeout !== undefined) node.timeout = hook.timeout;
    if (hook.failAction === 'ignore' || hook.failAction === 'warn') node.failOnNonZero = false;

    // "after" 배치: dependsOn으로 순서 표현
    if (placement.position === 'after') {
      node.dependsOn = [placement.relativeTo];
    }

    nodes.push(node);
  }

  return { nodes, skipped, warnings };
}
