import type { NodeSpecBase } from '../common';

export interface NotifyConfig {
  channels?: string[]; // 'slack' | 'email' 등
  webhookUrl?: string; // Slot 1 가능
  reminderAfter?: number; // 초, 0 = reminder 없음
  messageTemplate?: string; // Slot 1 가능
}

export interface GateNodeSpec extends NodeSpecBase {
  type: 'gate';
  prompt: string; // 사용자에게 보여줄 질문
  options: string[]; // 선택 가능한 옵션 (기계 식별자 권장)
  defaultOption?: string; // timeout 시 자동 선택
  artifactsToShow?: string[]; // 참고 자료로 표시할 노드 ID 목록
  notifyConfig?: NotifyConfig;
}
