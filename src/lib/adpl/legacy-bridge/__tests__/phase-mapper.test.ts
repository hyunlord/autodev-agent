import { describe, it, expect } from 'vitest';
import { mapEventToPlacement } from '../phase-mapper';

describe('mapEventToPlacement', () => {
  it('1. 조사서 §1.2 기준 주요 이벤트 7개의 올바른 placement', () => {
    expect(mapEventToPlacement('PreVerify')).toEqual({ relativeTo: 'verify', position: 'before' });
    expect(mapEventToPlacement('PostVerify')).toEqual({ relativeTo: 'verify', position: 'after'  });
    expect(mapEventToPlacement('PreCode')).toEqual({ relativeTo: 'code',   position: 'before' });
    expect(mapEventToPlacement('PostCode')).toEqual({ relativeTo: 'code',   position: 'after'  });
    expect(mapEventToPlacement('PrePlan')).toEqual({ relativeTo: 'plan',   position: 'before' });
    expect(mapEventToPlacement('PostPlan')).toEqual({ relativeTo: 'plan',   position: 'after'  });
    expect(mapEventToPlacement('TaskStart')).toEqual({ relativeTo: 'task',   position: 'before' });
  });

  it('2. pre-* 패턴 이벤트 → position: before', () => {
    expect(mapEventToPlacement('PrePlan')?.position).toBe('before');
    expect(mapEventToPlacement('PreCode')?.position).toBe('before');
    expect(mapEventToPlacement('PreVerify')?.position).toBe('before');
  });

  it('3. post-* 패턴 이벤트 → position: after', () => {
    expect(mapEventToPlacement('PostPlan')?.position).toBe('after');
    expect(mapEventToPlacement('PostCode')?.position).toBe('after');
    expect(mapEventToPlacement('PostVerify')?.position).toBe('after');
  });

  it('4. 알 수 없는 이벤트 → null 반환', () => {
    expect(mapEventToPlacement('UnknownEvent')).toBeNull();
    expect(mapEventToPlacement('RandomHook')).toBeNull();
    expect(mapEventToPlacement('')).toBeNull();
    // K9 이벤트 중 ADPL 등가 없는 것 → null
    expect(mapEventToPlacement('PreToolUse')).toBeNull();
    expect(mapEventToPlacement('PostToolUse')).toBeNull();
    expect(mapEventToPlacement('AgentSwitch')).toBeNull();
    expect(mapEventToPlacement('PreCompact')).toBeNull();
    expect(mapEventToPlacement('OnEscalation')).toBeNull();
  });

  it('5. 대소문자 변형에 강건 (PreVerify ≈ preVerify ≈ pre-verify ≈ PREVERIFY)', () => {
    const expected = { relativeTo: 'verify', position: 'before' };
    expect(mapEventToPlacement('PreVerify')).toEqual(expected);
    expect(mapEventToPlacement('preVerify')).toEqual(expected);
    expect(mapEventToPlacement('pre-verify')).toEqual(expected);
    expect(mapEventToPlacement('PREVERIFY')).toEqual(expected);
    expect(mapEventToPlacement('PRE_VERIFY')).toEqual(expected);
  });

  it('6. K9 이벤트 중 ADPL 등가 있는 것은 올바른 placement 반환', () => {
    expect(mapEventToPlacement('SessionStart')).toEqual({ relativeTo: 'task', position: 'before' });
    expect(mapEventToPlacement('SessionEnd')).toEqual({ relativeTo: 'task', position: 'after'  });
    expect(mapEventToPlacement('SubTaskStart')).toEqual({ relativeTo: 'code', position: 'before' });
    expect(mapEventToPlacement('SubTaskComplete')).toEqual({ relativeTo: 'code', position: 'after'  });
  });

  it('7. OnRetry, OnReplan, TaskComplete, TaskFail 배치 확인', () => {
    expect(mapEventToPlacement('OnRetry')).toEqual({ relativeTo: 'code',   position: 'before' });
    expect(mapEventToPlacement('OnReplan')).toEqual({ relativeTo: 'plan',   position: 'before' });
    expect(mapEventToPlacement('TaskComplete')).toEqual({ relativeTo: 'task',   position: 'after'  });
    expect(mapEventToPlacement('TaskFail')).toEqual({ relativeTo: 'task',   position: 'after'  });
  });
});
