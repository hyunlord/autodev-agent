export type InputFieldType = 'string' | 'number' | 'boolean' | 'select';

export interface InputField {
  name: string;
  type: InputFieldType;
  label?: string;
  required?: boolean;
  default?: unknown;
  options?: string[]; // type: 'select' 시
}

export interface ManualTrigger {
  id?: string;
  type: 'manual';
  enabled?: boolean; // default: true
  inputSchema?: InputField[]; // 실행 전 사용자 입력 폼
  confirmMessage?: string;
}
