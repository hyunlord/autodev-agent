import type { NodeSpecBase } from '../common';
import type { StructuredCondition } from '../expression';

// 기존 human-approval gate 설정 (Stage 5+ 구현 예정)
export interface NotifyConfig {
  channels?: string[]; // 'slack' | 'email' 등
  webhookUrl?: string; // Slot 1 가능
  reminderAfter?: number; // 초, 0 = reminder 없음
  messageTemplate?: string; // Slot 1 가능
}

/**
 * D4 조건 게이트 — condition 평가로 파이프라인 진행 여부 결정.
 * condition true → 통과 (completed), false → onFail 정책 적용.
 */
export interface GateNodeSpec extends NodeSpecBase {
  type: 'gate';
  condition: StructuredCondition;
  onFail?: 'throw' | 'fail_node'; // 기본값: 'throw'
  message?: string; // 실패 시 커스텀 메시지
}
