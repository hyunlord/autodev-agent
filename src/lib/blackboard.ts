/**
 * Shared Blackboard — 파이프라인 실행 중 에이전트 간 공유 상태.
 *
 * 라이프사이클: 파이프라인 시작 시 생성 → 각 에이전트가 read/write → 완료 시 소멸.
 *
 * Visibility Policy:
 * - public: 모든 에이전트 접근 가능
 * - planning-only: Planning만 쓰기, 나머지 읽기
 * - verify-hidden: Verify Agent에게 숨김 (self-rationalization 방지)
 */

export type Visibility = 'public' | 'planning-only' | 'verify-hidden';

export interface BlackboardEntry {
  key: string;
  value: unknown;
  visibility: Visibility;
  writtenBy: string;
  writtenAt: number;
}

export class Blackboard {
  private entries = new Map<string, BlackboardEntry>();

  /** 값 쓰기 */
  write(key: string, value: unknown, agentId: string, visibility: Visibility = 'public'): void {
    const existing = this.entries.get(key);
    if (existing?.visibility === 'planning-only' && !agentId.includes('planning')) {
      throw new Error(`Blackboard key "${key}" is planning-only, written by ${existing.writtenBy}`);
    }

    this.entries.set(key, {
      key,
      value,
      visibility,
      writtenBy: agentId,
      writtenAt: Date.now(),
    });
  }

  /** 값 읽기 (visibility 정책 적용) */
  read(key: string, readerAgentId: string): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.visibility === 'verify-hidden' && readerAgentId.includes('verify')) {
      return undefined;
    }

    return entry.value;
  }

  /** 에이전트가 볼 수 있는 모든 항목 반환 */
  getVisibleEntries(readerAgentId: string): Record<string, unknown> {
    const visible: Record<string, unknown> = {};
    for (const [key, entry] of this.entries) {
      if (entry.visibility === 'verify-hidden' && readerAgentId.includes('verify')) continue;
      visible[key] = entry.value;
    }
    return visible;
  }

  /** 프롬프트에 주입할 문자열 생성 */
  toPromptSection(readerAgentId: string): string {
    const visible = this.getVisibleEntries(readerAgentId);
    const entries = Object.entries(visible);
    if (entries.length === 0) return '';

    return '\n\n## Shared context (from previous pipeline stages)\n' +
      entries.map(([k, v]) =>
        `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`
      ).join('\n');
  }

  /** 전체 내용 (디버깅/저장용) */
  toJSON(): BlackboardEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}
