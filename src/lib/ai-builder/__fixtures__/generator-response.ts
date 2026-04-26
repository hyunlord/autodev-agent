/**
 * Stage 7 G6 G20-1 — Generator LLM response fixtures.
 *
 * Raw strings that mirror what the generator model returns. JSON.stringify
 * guarantees correct escaping so multiline YAML inside generated_yaml is safe.
 * malformedJson and missingRequiredField are error-path fixtures.
 */

export const newPipelineResponse = JSON.stringify({
  intent_recognized: 'new',
  needs_clarification: false,
  generated_yaml: [
    'adplVersion: 1',
    'name: daily-report',
    '',
    'triggers:',
    '  - id: on-schedule',
    '    type: schedule',
    '    cron: "0 9 * * *"',
    '',
    'pipeline:',
    '  - id: generate',
    '    type: agent',
    '    role: coder',
    '    model: claude-code',
    '    useMemory: true',
    '',
  ].join('\n'),
  explanation: '매일 오전 9시에 실행되는 일일 보고서 파이프라인을 생성했습니다.',
  warnings: [],
  suggested_next_steps: ['트리거 시간대 확인', '보고서 출력 형식 지정'],
});

export const modifyResponse = JSON.stringify({
  intent_recognized: 'modify',
  needs_clarification: false,
  generated_yaml: [
    'adplVersion: 1',
    'name: legacy-dev-pipeline',
    '',
    'triggers:',
    '  - id: task',
    '    type: task_created',
    '',
    'pipeline:',
    '  - id: plan',
    '    type: agent',
    '    role: planner',
    '    model: gemini-cli',
    '    useMemory: true',
    '  - id: code',
    '    type: agent',
    '    role: coder',
    '    model: claude-code',
    '    inputs:',
    '      plan: "${$nodes.plan.output.data}"',
    '    useMemory: true',
    '  - id: notify',
    '    type: shell',
    '    command: "echo 완료"',
    '',
  ].join('\n'),
  explanation: '알림 노드를 파이프라인 끝에 추가했습니다.',
  warnings: [],
  suggested_next_steps: [],
});

export const clarifyResponse = JSON.stringify({
  intent_recognized: 'clarify',
  needs_clarification: true,
  explanation: '요청이 너무 추상적입니다. 구체적인 트리거와 실행할 작업을 알려주세요.',
  warnings: ['요청에 구체적인 동작이 없습니다'],
  suggested_next_steps: ['어떤 이벤트에 반응해야 하나요?', '어떤 작업을 실행해야 하나요?'],
});

/** Truncated JSON — extractJson 모든 stage 실패 → parseResponse throws. */
export const malformedJson = '{"intent_recognized":"new","needs_clarification":false';

/** Valid JSON but missing required intent_recognized — Zod safeParse fails. */
export const missingRequiredField = JSON.stringify({
  needs_clarification: false,
  explanation: 'intent_recognized 필드 없음',
});
