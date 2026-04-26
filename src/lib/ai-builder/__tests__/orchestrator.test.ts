import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIBuilderOrchestrator } from '../orchestrator';
import {
  newPipelineResponse,
  modifyResponse,
  clarifyResponse,
  malformedJson,
  missingRequiredField,
} from '../__fixtures__/generator-response';

const { mockClassify, mockAssemble, mockCreate, mockCompile } = vi.hoisted(() => ({
  mockClassify: vi.fn(),
  mockAssemble: vi.fn(),
  mockCreate: vi.fn(),
  mockCompile: vi.fn(),
}));

vi.mock('../intent/classifier', () => ({
  classifyIntent: mockClassify,
  // Pure function — keep real implementation so cost assertions are exact.
  computeCost: (inputTokens: number, outputTokens: number) =>
    (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0,
}));

vi.mock('../context/assembler', () => ({
  assembleSystemPrompt: mockAssemble,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function (
    this: { messages: { create: typeof mockCreate } },
  ) {
    this.messages = { create: mockCreate };
  }),
}));

vi.mock('@/lib/adpl/engine/compiler', () => ({
  PipelineCompiler: vi.fn().mockImplementation(function (
    this: { compile: typeof mockCompile },
  ) {
    this.compile = mockCompile;
  }),
}));

function classified(intent: 'new' | 'modify' | 'clarify' | 'explain', fallbackUsed = false) {
  return {
    intent,
    confidence: fallbackUsed ? 0.5 : 0.9,
    reason: fallbackUsed ? 'fallback: SDK call failed (mocked)' : 'ok',
    costUsd: fallbackUsed ? 0 : 0.001,
    inputTokens: fallbackUsed ? 0 : 100,
    outputTokens: fallbackUsed ? 0 : 20,
    fallbackUsed,
  };
}

function assembled(estimatedSystemTokens = 5000) {
  return {
    systemPrompt: 'mocked system prompt',
    userMessage: 'mocked user message',
    conversationHistory: [],
    fragmentsUsed: [] as string[],
    estimatedSystemTokens,
  };
}

function llmSdkResponse(text: string, inputTokens = 200, outputTokens = 300) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClassify.mockReset();
  mockAssemble.mockReset();
  mockCreate.mockReset();
  mockCompile.mockReset();
  mockAssemble.mockReturnValue(assembled());
  mockCreate.mockResolvedValue(llmSdkResponse(newPipelineResponse));
  // 기본: Compiler 는 성공 반환 (happy path)
  mockCompile.mockResolvedValue({ ok: true, plan: {}, warnings: [] });
});

describe('AIBuilderOrchestrator (G20-1)', () => {
  // ── Previously G19-3c tests (updated for live callLlm) ────────────────

  it('intent="new" when classifier returns new', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'create a new pipeline',
      projectId: 'p1',
    });
    expect(result.intent).toBe('new');
    expect(result.steps).toContain('classify_intent');
    expect(result.steps).toContain('assemble_context');
    expect(result.steps).toContain('call_llm');
    expect(result.steps).toContain('parse_response');
    expect(result.steps).toContain('validate');
  });

  it('intent="modify" when classifier returns modify', async () => {
    mockClassify.mockResolvedValueOnce(classified('modify'));
    mockCreate.mockResolvedValueOnce(llmSdkResponse(modifyResponse));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'add a step',
      projectId: 'p1',
      currentYaml: 'adplVersion: 1\nname: x\npipeline: []\n',
    });
    expect(result.intent).toBe('modify');
    expect(result.steps).toContain('call_llm');
    expect(result.steps).toContain('validate');
  });

  it('SDK throw during call_llm → error result, call_llm absent from steps', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockCreate.mockRejectedValueOnce(new Error('rate limit exceeded'));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'anything',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('call_llm failed'))).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.steps).not.toContain('call_llm');
  });

  it('classifier fallbackUsed=true → warnings include classification fallback', async () => {
    mockClassify.mockResolvedValueOnce(classified('modify', true));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'change something',
      projectId: 'p1',
      currentYaml: 'adplVersion: 1\nname: x\npipeline: []\n',
    });
    expect(result.warnings).toContain('intent classification fallback used');
  });

  it('assembler throw → graceful fallback with assemble_context warning', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockAssemble.mockImplementationOnce(() => {
      throw new Error('disk read failed');
    });
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'anything',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('assemble_context failed'))).toBe(true);
    expect(result.steps).toEqual(['classify_intent']);
  });

  it('estimatedSystemTokens > soft budget → warnings include budget notice', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockAssemble.mockReturnValueOnce(assembled(15000));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'anything',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('soft budget'))).toBe(true);
  });

  // ── New tests (G20-1) ─────────────────────────────────────────────────

  it('happy path: new → generatedYaml contains ADPL, steps complete through validate', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build me a daily report pipeline',
      projectId: 'p1',
    });
    expect(result.generatedYaml).toBeDefined();
    expect(result.generatedYaml).toContain('adplVersion: 1');
    expect(result.needsClarification).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.steps).toEqual([
      'classify_intent',
      'assemble_context',
      'call_llm',
      'parse_response',
      'validate',
    ]);
  });

  it('happy path: clarify → needsClarification=true, generatedYaml absent', async () => {
    mockClassify.mockResolvedValueOnce(classified('clarify'));
    mockCreate.mockResolvedValueOnce(llmSdkResponse(clarifyResponse));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'do something useful',
      projectId: 'p1',
    });
    expect(result.intent).toBe('clarify');
    expect(result.needsClarification).toBe(true);
    expect(result.generatedYaml).toBeUndefined();
    expect(result.steps).toContain('validate');
  });

  it('parse_response: malformed JSON → error result, call_llm in steps, parse_response absent', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockCreate.mockResolvedValueOnce(llmSdkResponse(malformedJson));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build me something',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('parse_response failed'))).toBe(true);
    expect(result.steps).toContain('call_llm');
    expect(result.steps).not.toContain('parse_response');
  });

  it('parse_response: Zod fails (no intent_recognized) → error result', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockCreate.mockResolvedValueOnce(llmSdkResponse(missingRequiredField));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build me something',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('parse_response failed'))).toBe(true);
    expect(result.steps).toContain('call_llm');
    expect(result.steps).not.toContain('parse_response');
  });

  it('cost: totalCostUsd = classifier cost + generator cost', async () => {
    mockClassify.mockResolvedValueOnce(classified('new')); // costUsd = 0.001
    // 1_000_000 input tokens × $3/M = $3.000
    mockCreate.mockResolvedValueOnce(llmSdkResponse(newPipelineResponse, 1_000_000, 0));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build a pipeline',
      projectId: 'p1',
    });
    expect(result.totalCostUsd).toBeCloseTo(3.001, 3);
  });

  it('cost: call_llm error → totalCostUsd equals classifier cost only', async () => {
    mockClassify.mockResolvedValueOnce(classified('new')); // costUsd = 0.001
    mockCreate.mockRejectedValueOnce(new Error('network error'));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build a pipeline',
      projectId: 'p1',
    });
    expect(result.totalCostUsd).toBeCloseTo(0.001, 6);
  });

  it('token tracking: inputTokens and outputTokens reflect generator response', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockCreate.mockResolvedValueOnce(llmSdkResponse(newPipelineResponse, 500, 800));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build a pipeline',
      projectId: 'p1',
    });
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(800);
  });

  // ── New tests (G20-2) ─────────────────────────────────────────────────

  it('validate: success on first attempt → steps includes validate, attempts=1', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockCompile.mockResolvedValueOnce({ ok: true, plan: {}, warnings: [] });
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build me a pipeline',
      projectId: 'p1',
    });
    expect(result.steps).toContain('validate');
    expect(result.attempts).toBe(1);
    expect(result.generatedYaml).toBeDefined();
  });

  it('validate: fails first attempt, succeeds on retry → attempts=2', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    // 1차: 실패
    mockCompile.mockResolvedValueOnce({
      ok: false,
      errors: [{ code: 'parse_error', message: 'invalid YAML structure' }],
      warnings: [],
    });
    // 2차: 성공
    mockCompile.mockResolvedValueOnce({ ok: true, plan: {}, warnings: [] });

    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build me a pipeline',
      projectId: 'p1',
    });
    expect(result.attempts).toBe(2);
    expect(result.steps).toContain('validate');
    // retry 시 SDK 가 2번 호출됨
    expect(mockCreate).toHaveBeenCalledTimes(2);
    // 2번째 SDK 호출에 retry messages 포함 (assistant + user role)
    const secondCall = mockCreate.mock.calls[1][0] as { messages: Array<{ role: string }> };
    const roles = secondCall.messages.map((m) => m.role);
    expect(roles).toContain('assistant');
    // 2번째 SDK 호출의 마지막 2개 message: assistant(이전 응답) + user(에러 메시지)
    const secondCallMessages = (mockCreate.mock.calls[1][0] as { messages: Array<{ role: string; content: string }> }).messages;
    const retryAssistant = secondCallMessages[secondCallMessages.length - 2];
    const retryUser = secondCallMessages[secondCallMessages.length - 1];
    expect(retryAssistant.role).toBe('assistant');
    expect(retryUser.role).toBe('user');
    expect(retryUser.content).toContain('parse_error');
    expect(retryUser.content).toContain('invalid YAML structure');
  });

  it('validate: all 3 attempts fail → max retry result with last YAML in warnings', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    const compileFailure = {
      ok: false,
      errors: [{ code: 'cycle_detected', message: 'cycle in node graph' }],
      warnings: [],
    };
    mockCompile
      .mockResolvedValueOnce(compileFailure)
      .mockResolvedValueOnce(compileFailure)
      .mockResolvedValueOnce(compileFailure);

    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build me a pipeline',
      projectId: 'p1',
    });
    expect(result.attempts).toBe(3);
    expect(result.generatedYaml).toBeDefined(); // 마지막 YAML 노출
    expect(result.warnings.some((w) => w.includes('Max retry attempts (3) reached'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('cycle_detected'))).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(3);
    // 2번째 SDK 호출의 retry user message 가 cycle_detected 에러 포함
    const secondCallMsgs = (mockCreate.mock.calls[1][0] as { messages: Array<{ role: string; content: string }> }).messages;
    const retryMsg = secondCallMsgs[secondCallMsgs.length - 1];
    expect(retryMsg.role).toBe('user');
    expect(retryMsg.content).toContain('cycle_detected');
  });

  it('validate: clarify intent skips ADPL compile (no generated_yaml)', async () => {
    mockClassify.mockResolvedValueOnce(classified('clarify'));
    mockCreate.mockResolvedValueOnce(llmSdkResponse(clarifyResponse));

    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'do something',
      projectId: 'p1',
    });
    expect(result.intent).toBe('clarify');
    expect(result.needsClarification).toBe(true);
    expect(result.steps).toContain('validate');
    // compile 은 호출되지 않음 (yaml 없으므로 skip)
    expect(mockCompile).not.toHaveBeenCalled();
    expect(result.attempts).toBe(1);
  });

  it('validate: compiler warnings propagated into result warnings', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockCompile.mockResolvedValueOnce({
      ok: true,
      plan: {},
      warnings: [{ code: 'parse_error', message: 'deprecated field used' }],
    });

    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build a pipeline',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('deprecated field used'))).toBe(true);
  });

  it('warnings: parsed LLM warnings merged into result warnings', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    // newPipelineResponse 에는 warnings: [] — 커스텀 응답으로 warnings 포함
    const responseWithWarnings = JSON.stringify({
      intent_recognized: 'new',
      needs_clarification: false,
      generated_yaml:
        'adplVersion: 1\nname: test-pipe\npipeline:\n  - id: step1\n    type: agent\n    role: coder\n    model: claude-code\n',
      explanation: 'test',
      warnings: ['llm generated warning'],
    });
    mockCreate.mockResolvedValueOnce(llmSdkResponse(responseWithWarnings));

    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'build a pipeline',
      projectId: 'p1',
    });
    expect(result.warnings).toContain('llm generated warning');
  });
});
