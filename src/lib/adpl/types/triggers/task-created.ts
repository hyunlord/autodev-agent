import type { Condition } from '../expression';

export interface TaskCreatedTrigger {
  id?: string;
  type: 'task_created';
  enabled?: boolean; // default: true
  filter?: Condition;
  projectId?: string; // 특정 프로젝트 Task에만 반응
  tags?: string[]; // 이 태그 중 하나라도 있을 때만 실행
}
