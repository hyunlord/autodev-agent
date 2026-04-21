export interface PhysicalPlacement {
  relativeTo: string;
  position: 'before' | 'after';
}

// 정규화(lowercase + 하이픈/언더스코어 제거)된 이벤트명 → Phase P 배치
// K9 이벤트 중 ADPL 등가 노드 없는 것(PreToolUse, PostToolUse, AgentSwitch, PreCompact, OnEscalation)은 미포함 → null 반환
const PLACEMENT_MAP: Readonly<Record<string, PhysicalPlacement>> = {
  taskstart:       { relativeTo: 'task',   position: 'before' },
  preplan:         { relativeTo: 'plan',   position: 'before' },
  postplan:        { relativeTo: 'plan',   position: 'after'  },
  planreview:      { relativeTo: 'plan',   position: 'after'  },
  precode:         { relativeTo: 'code',   position: 'before' },
  postcode:        { relativeTo: 'code',   position: 'after'  },
  preverify:       { relativeTo: 'verify', position: 'before' },
  postverify:      { relativeTo: 'verify', position: 'after'  },
  onretry:         { relativeTo: 'code',   position: 'before' },
  onreplan:        { relativeTo: 'plan',   position: 'before' },
  taskcomplete:    { relativeTo: 'task',   position: 'after'  },
  taskfail:        { relativeTo: 'task',   position: 'after'  },
  sessionstart:    { relativeTo: 'task',   position: 'before' },
  sessionend:      { relativeTo: 'task',   position: 'after'  },
  subtaskstart:    { relativeTo: 'code',   position: 'before' },
  subtaskcomplete: { relativeTo: 'code',   position: 'after'  },
};

/**
 * 21개 legacy 이벤트 이름을 Phase P 노드의 before/after 배치로 변환.
 * 'PreVerify' | 'preVerify' | 'pre-verify' | 'PREVERIFY' 모두 동일 결과.
 * ADPL 등가 노드가 없는 이벤트(K9 일부)는 null 반환.
 */
export function mapEventToPlacement(eventName: string): PhysicalPlacement | null {
  const normalized = eventName.toLowerCase().replace(/[-_]/g, '');
  return PLACEMENT_MAP[normalized] ?? null;
}
