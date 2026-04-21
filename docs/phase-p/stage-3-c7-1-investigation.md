# AutoDev Agent Executor 구조 조사 보고서

**작성일**: 2026-04-21  
**대상**: Planning Agent, Coding Agent, Verify Agent, Debate Mode  
**목적**: 기존 3개 executor의 실제 구조 파악 및 Wrapper/Adapter 패턴 적용 난이도 평가

---

## 1. 파일 위치 (정확한 경로)

### 1.1 Planning Agent
- **메인 파일**: `src/agents/planning/planning-agent.ts` (65줄)
- **워커 구현**: `src/worker/planning.ts` (647줄)
- **인터페이스**: `src/agents/interfaces.ts` (108줄)

### 1.2 Coding Agent
- **Wrapper 클래스**: `src/agents/coding/coding-agent.ts` (59줄)
- **Claude Code 백엔드**: `src/lib/plugins/agents/claude-code.ts` (297줄)
- **Codex CLI 백엔드**: `src/lib/plugins/agents/codex-cli.ts` (134줄)
- **Gemini CLI 백엔드**: `src/lib/plugins/agents/gemini-cli.ts` (50줄)
- **인터페이스**: `src/lib/plugins/interfaces.ts` (99줄)

### 1.3 Verify Agent
- **메인 파일**: `src/agents/verify/verify-agent.ts` (1,641줄) ⚠️ 매우 큼
- **Playwright 도구**: `src/agents/verify/tools/playwright-verify.ts` (89줄)
- **인터페이스**: `src/agents/interfaces.ts` (108줄)

### 1.4 Debate Mode
- **DebatePlanner 클래스**: `src/agents/planning/debate-planner.ts` (470줄)
- **워커 재사용**: Planning 워커의 `generatePlan()` 호출

### 1.5 CLI Resolver & Utils
- **CLI 경로 해석**: `src/lib/cli-resolver.ts` (105줄)
- **execa 래퍼**: `src/lib/execa.ts`

---

## 2. 진입점 함수 Signature

### 2.1 Planning Agent

```typescript
// 파일: src/agents/planning/planning-agent.ts, 줄 32-64

async invoke(input: AgentInput): Promise<PlanningOutput>

// AgentInput 타입:
interface AgentInput {
  prompt: string;
  context: {
    projectDir: string;
    projectType?: string;
    files?: string[];
    gitStatus?: string;
    previousResults?: unknown;
    verifyFeedback?: VerifyFeedback;
    projectConfig?: unknown;
    workspaceContext?: string;
    mcpServers?: unknown[];
  };
  config: {
    systemPrompt?: string;
    maxBudgetUsd?: number;
    timeoutMs?: number;
  };
  onProgress?: (event: PipelineEvent) => void;
}

// PlanningOutput 타입:
interface PlanningOutput extends AgentOutput {
  result: {
    plan: Plan;
    inputTokens: number;
    outputTokens: number;
  };
}

// 클래스 구성:
export class PlanningAgent implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly role = 'planning' as const;
  private mode: PlanningMode;

  constructor(mode?: string) {
    this.mode = (mode ?? 'claude-cli') as PlanningMode;
    this.id = `planning-${this.mode}`;
    this.name = `Planning Agent (${this.mode})`;
  }

  async isAvailable(): Promise<boolean>;
  async invoke(input: AgentInput): Promise<PlanningOutput>;
}
```

**특징**:
- 내부적으로 `generatePlan()` 워커 함수 호출 (라인 39-48)
- 모드별 분기 없음 (내부 워커가 처리)
- onProgress 콜백으로 스트리밍 로그 지원
- 반환값에 costUsd, tokenUsage, durationMs 포함

### 2.2 Coding Agent

```typescript
// 파일: src/agents/coding/coding-agent.ts, 줄 27-53

async invoke(input: AgentInput): Promise<CodingOutput>

// CodingOutput 타입:
interface CodingOutput extends AgentOutput {
  result: {
    text: string;
    modifiedFiles: string[];
  };
}

// 클래스 구성:
export class CodingAgentWrapper implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly role = 'coding' as const;
  private inner: ICodingAgent;

  constructor(inner: ICodingAgent) {
    this.inner = inner;
    this.id = inner.id;
    this.name = inner.name;
  }

  async isAvailable(): Promise<boolean>;
  async invoke(input: AgentInput): Promise<CodingOutput>;
  getInner(): ICodingAgent;  // 역호환성
}

// ICodingAgent 인터페이스 (내부 백엔드들이 구현):
interface ICodingAgent {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>;
}

// 옵션:
interface CodingAgentOptions {
  task: string;
  projectDir: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  testCmd?: string;
  model?: string;
  mcpServers?: McpServerInfo[];
  onProgress?: (event: PipelineEvent) => void;
}
```

**특징**:
- Wrapper 패턴: 여러 ICodingAgent 구현을 감싼다
- AgentInput → CodingAgentOptions 변환 (라인 28-35)
- 내부 구현(Claude Code/Codex/Gemini)에서 실제 작업 수행

### 2.3 Coding Agent 백엔드들

#### Claude Code Agent
```typescript
// 파일: src/lib/plugins/agents/claude-code.ts, 줄 71-165

async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>

// 내부 구성:
export class ClaudeCodeAgent implements ICodingAgent {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean>;
  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>;
  private async invokeViaSdk(opts): Promise<CodingAgentResult>;
  private async invokeViaCli(opts): Promise<CodingAgentResult>;
}

// SDK 호출 (라인 84-165):
//   import('@anthropic-ai/claude-agent-sdk').query()
//   → AsyncIterable<{ type, message, tool_progress, result, ... }>
//   → 이벤트 스트리밍 + 최종 결과 추출

// CLI 폴백 (라인 167-295):
//   execa(cliPath, ['-p', task, '--output-format', 'stream-json', ...])
//   → stream-json 파싱 (라인 235-260)
//   → progress 이벤트 → onProgress 콜백
//   → 최종 result 이벤트에서 costUsd, tokenUsage 추출
```

**특징**:
- 이중 백엔드: SDK 우선, CLI 폴백 (라인 72-81)
- SDK: AsyncIterable → 실시간 이벤트 스트리밍
- CLI: stream-json 형식, MCP config 파일 임시 생성 (라인 186-200)
- MCP 서버 지원: opts.mcpServers → tmpdir에 JSON 작성 후 --mcp-config

#### Codex CLI Agent
```typescript
// 파일: src/lib/plugins/agents/codex-cli.ts, 줄 16-74

async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>

// 클래스:
export class CodexCliAgent implements ICodingAgent {
  readonly id = 'codex-cli';
  readonly name = 'Codex CLI';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean>;
  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>;
  private async parseResult(result, opts, startTime): Promise<CodingAgentResult>;
}

// exec 모드 호출 (라인 32-43):
// execa(cliPath, [
//   'exec',
//   '--full-auto',
//   '--sandbox', 'workspace-write',  // ← CRITICAL
//   '--json',
//   promptForCli,  // ← 최대 12K 글자 (라인 25-30)
// ])

// JSONL 파싱 (라인 76-131):
// 라인-by-라인 JSON 추출
// type='item.completed' + item.type='agent_message' → 결과 텍스트
```

**특징**:
- Prompt 슬라이싱: 12,000자 제한 + truncation 경고 (라인 25-30)
- --sandbox workspace-write: 반드시 필요 (기본값은 read-only)
- --json 실패 시 재시도 (라인 48-67): --json 없이 재실행
- JSONL STDOUT 파싱: 역순(reverse)으로 최신 결과 찾기 (라인 89)

#### Gemini CLI Agent
```typescript
// 파일: src/lib/plugins/agents/gemini-cli.ts, 줄 16-50

async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>

// 클래스:
export class GeminiCliAgent implements ICodingAgent {
  readonly id = 'gemini-cli';
  readonly name = 'Gemini CLI';
  private resolvedPath: string | null = null;

  async isAvailable(): Promise<boolean>;
  async invoke(opts: CodingAgentOptions): Promise<CodingAgentResult>;
}

// 단순 호출 (라인 22):
// execa(cliPath, [
//   '-p', opts.task,
//   '--output-format', 'json',
//   '-y',  // ← auto-approve
// ])

// JSON 파싱 (라인 30-38):
// JSON.parse(result.stdout)
// → parsed.response || parsed.result || ...
```

**특징**:
- 가장 간단한 구현 (50줄)
- -y 플래그: 사용자 입력 자동 승인
- JSON 파싱 실패 시 markdown 펜스 제거 (라인 37)
- 가격 추정: gemini-2.5-pro $1.25/M input, $10.0/M output (라인 40-46)

### 2.4 Verify Agent

```typescript
// 파일: src/agents/verify/verify-agent.ts, 줄 70-301

async invoke(input: AgentInput): Promise<AgentOutput>

// 클래스:
export class VerifyAgent implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly role = 'verify' as const;
  private llm: string;
  fallbackLlms: string[] = [];

  constructor(llm?: string);
  async isAvailable(): Promise<boolean>;
  async invoke(input: AgentInput): Promise<AgentOutput>;
  static async selectDifferentFrom(codingAgentId): Promise<...>;
}

// 입력:
interface VerifyInput extends AgentInput {
  originalPrompt: string;
  modifiedFiles: string[];
  projectDir: string;
  tools: VerifyTool[];
  skipMechanical?: boolean;
  depth?: 'fast' | 'standard' | 'deep';
  plan?: {
    acceptanceCriteria?: AcceptanceCriteria;
    [key: string]: unknown;
  };
}

// 출력:
interface VerifyResult {
  passed: boolean;
  score: number;
  reason: string;
  issues: string[];
  suggestions: string[];
  verdict: 'pass' | 're-code' | 're-plan' | 'fail' | 'warn';
  evidence: {
    screenshots?: string[];
    buildResult?: string;
    consoleErrors?: string[];
    executionOutput?: string;
    codeReview?: string;
  };
}
```

**특징**:
- 3단계 검증 파이프라인 (라인 70-301)
- 깊이 조절: fast/standard/deep (라인 75)
- LLM 자동 선택: Codex > Gemini > Claude (라인 44-68)
- Fallback chain: 첫 LLM 실패 시 다음 LLM 시도 (라인 1169-1175)

### 2.5 Debate Planner

```typescript
// 파일: src/agents/planning/debate-planner.ts, 줄 44-150+

async invoke(input: AgentInput): Promise<DebatePlanningOutput>

// 클래스:
export class DebatePlanner implements IAgent {
  readonly id = 'planning-debate';
  readonly name = 'Planning Agent (Debate Mode)';
  readonly role = 'planning' as const;
  private cliMode: PlanningMode;

  constructor(cliMode?: PlanningMode);
  async isAvailable(): Promise<boolean>;
  async invoke(input: AgentInput): Promise<DebatePlanningOutput>;
  private async runChallenger(...): Promise<...>;
  private async runDrafterRevision(...): Promise<...>;
  private async runQualityChecker(...): Promise<...>;
}

// 출력:
interface DebatePlanningOutput extends AgentOutput {
  result: {
    plan: Plan;
    rounds: DebateRound[];
    totalRounds: number;
    inputTokens: number;
    outputTokens: number;
  };
}

// 라운드 구조:
interface DebateRound {
  draft: string;
  challenge: string;
  revision: string;
  qcVerdict: 'approved' | 'revise' | 'fail';
  qcFeedback: string;
}
```

**특징**:
- 4단계 루프 (최대 2라운드, 라인 82): Drafter → Challenger → Revision → QC
- generatePlan() 재사용 (라인 61-70)
- runChallenger(), runDrafterRevision(), runQualityChecker() 3개 private 메서드
- MAX_DEBATE_ROUNDS = 2 (라인 28)

---

## 3. 이벤트 구조 (Streaming)

### 3.1 Planning Agent
**방식**: Callback (onProgress)
```typescript
// 라인 34: emit = input.onProgress ?? (() => {})
// 라인 44: emit({ type: 'log', level: 'info', message: msg } as PipelineEvent)

// PipelineEvent 타입:
type PipelineEvent = {
  type: 'log' | 'progress' | 'error' | 'result';
  level?: 'info' | 'warn' | 'error';
  message?: string;
  data?: unknown;
};
```

### 3.2 Coding Agent (Claude Code SDK)
**방식**: AsyncIterable
```typescript
// 라인 92-99: for await (const msg of query({...})) {
// 메시지 구조:
{
  type: 'assistant' | 'tool_use_summary' | 'tool_progress' | 'result' | 'error';
  message?: { content: Array<{ type, text, name, input }> };
  summary?: string;
  tool_name?: string;
  elapsed_time_seconds?: number;
  result?: string;
  total_cost_usd?: number;
  usage?: { input_tokens, output_tokens };
}
```

### 3.3 Coding Agent (Claude Code CLI)
**방식**: stream-json stdout
```typescript
// 라인 225-260: childProcess.stdout.on('data', (chunk) => { ... })
// 각 라인은 JSON:
{
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'system';
  message?: string | { content: [...] };
  name?: string;  // tool name
  input?: {};     // tool input
  error?: string;
  result?: string;
  cost_usd?: number;
  usage?: { input_tokens, output_tokens };
}
```

### 3.4 Verify Agent
**방식**: Callback (onProgress)
```typescript
// 라인 74: emit = input.onProgress ?? (() => {})
// 전체 파이프라인에서 emit() 호출
// - Stage 1: Mechanical checks (라인 81-95)
// - Stage 2: Evidence collection (라인 113-672)
// - Stage 2.5: Visual analysis (라인 616-670)
// - Stage 2.8: Acceptance criteria (라인 146-175)
// - Stage 2.9a: SAST (라인 213-230)
// - Stage 2.9b: A11y (라인 232-251)
// - Stage 3.5: PBT (라인 253-271)
// - Stage 3: LLM judgment (라인 273-301)
```

---

## 4. 입력 구조

### 4.1 Planning Agent
```typescript
input: AgentInput = {
  prompt: string;                    // "Make a counter..."
  context: {
    projectDir: string;              // "/path/to/project"
    projectConfig?: ProjectConfig;   // { type, language, buildCmd, ... }
    workspaceContext?: string;       // "Files in project: ..."
  };
  config: {
    systemPrompt?: string;           // Custom planner instructions
    maxBudgetUsd?: number;
    timeoutMs?: number;              // 기본값 120_000 (라인 216)
  };
  onProgress?: (event) => void;
};
```

**주목할 점**:
- systemPrompt 지원 (라인 47)
- workspaceContext 전달 (라인 46)
- projectConfig → projectContext 변환 (라인 36, 191-193)

### 4.2 Coding Agent
```typescript
input: AgentInput
  ↓ (라인 28-35 변환)
opts: CodingAgentOptions = {
  task: string;                      // input.prompt
  projectDir: string;                // input.context.projectDir
  maxBudgetUsd?: number;             // input.config.maxBudgetUsd
  timeoutMs?: number;                // input.config.timeoutMs (기본값 300_000)
  mcpServers?: McpServerInfo[];      // input.context.mcpServers
  onProgress?: (event) => void;      // input.onProgress
};
```

### 4.3 Verify Agent
```typescript
input: VerifyInput = {
  // AgentInput 상속 +
  originalPrompt: string;            // 사용자 원래 요청
  modifiedFiles: string[];           // ["src/app.js", ...]
  projectDir: string;                // 프로젝트 경로
  tools: VerifyTool[];               // MCP 도구 (Playwright, browser_navigate, ...)
  skipMechanical?: boolean;          // Code review 모드 (라인 997)
  depth?: 'fast' | 'standard' | 'deep';  // 기본값 'deep' (라인 75)
  plan?: {
    acceptanceCriteria?: {
      requiredFiles?: string[];
      security?: { semgrepScan?: boolean };
      pbt?: boolean;                  // Property-Based Testing
      debateVerify?: boolean;         // Debate verification
    };
  };
};
```

**특이점**:
- tools 배열: Playwright, browser_navigate, browser_screenshot, browser_evaluate, browser_wait_for (라인 234-250)
- depth 조절: fast/standard/deep 각각 다른 검증 깊이 (라인 97-209)
- plan.acceptanceCriteria: 하드 요구사항 (라인 147-175)

---

## 5. 출력 구조

### 5.1 Planning Agent
```typescript
{
  success: true;
  result: {
    plan: {
      summary: string;
      taskCategory?: string;         // "frontend" | "backend" | ...
      codingPrompt: string;          // 코딩 지시
      estimatedFiles: string[];      // ["index.html", "script.js"]
      verificationSpec: {
        steps: Array<{
          id: string;
          type: 'build_check' | 'file_check' | 'dom_check' | 'http_check' | ...;
          description: string;
          command?: string;
          url?: string;
          filePath?: string;
          // ... 더 많은 필드
        }>;
      };
      acceptanceCriteria?: {
        requiredFiles?: string[];
        security?: { semgrepScan?: boolean };
        pbt?: boolean;
        debateVerify?: boolean;
      };
    };
    inputTokens: number;
    outputTokens: number;
  };
  costUsd: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
}
```

### 5.2 Coding Agent
```typescript
{
  success: boolean;
  result: {
    text: string;                    // 최종 결과 텍스트
    modifiedFiles: string[];         // git diff로 추출 (라인 284)
  };
  costUsd: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  rawOutput?: string;                // 전체 stdout (라인 293)
}
```

### 5.3 Verify Agent
```typescript
{
  success: true;
  result: {
    passed: boolean;
    score: number;                   // 0-100
    reason: string;
    issues: string[];                // 발견된 이슈
    suggestions: string[];           // 수정 제안
    verdict: 'pass' | 're-code' | 're-plan' | 'fail' | 'warn';
    evidence: {
      screenshots?: string[];
      buildResult?: string;
      consoleErrors?: string[];
      executionOutput?: string;
      codeReview?: string;
    };
  };
  costUsd: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
}
```

---

## 6. CLI 백엔드 처리 (Coding Agent 특화)

### 6.1 Claude Code CLI
**파일**: `src/lib/plugins/agents/claude-code.ts`

**SDK 경로** (라인 84-165):
```typescript
// 1. SDK import 시도
import('@anthropic-ai/claude-agent-sdk').query({
  prompt: opts.task,
  options: {
    cwd: opts.projectDir,
    allowedTools: ['Read', 'Write', 'Bash'],
    maxTurns: opts.maxTurns ?? 20,
  },
})

// 2. AsyncIterable 순회
for await (const msg of query(...)) {
  // msg.type: 'assistant', 'tool_use_summary', 'tool_progress', 'result', 'error'
  // 실시간 이벤트 처리
}

// 3. 최종 result 이벤트에서 costUsd, tokenUsage 추출
```

**CLI 폴백** (라인 167-295):
```typescript
// 1. execa 호출
const childProcess = execa(cliPath, [
  '-p', opts.task,
  '--output-format', 'stream-json',
  '--max-turns', String(opts.maxTurns ?? 20),
  '--dangerously-skip-permissions',
  ...(opts.model ? ['--model', opts.model] : []),
], {
  cwd: opts.projectDir,
  timeout: opts.timeoutMs ?? 300_000,
  reject: false,
})

// 2. stdout 스트림 파싱 (라인 223-262)
childProcess.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  
  for (const line of lines) {
    const event = JSON.parse(line);
    // 이벤트별 처리: assistant, tool_use, result, ...
    // 각 이벤트마다 onProgress 콜백
  }
})

// 3. MCP 서버 지원 (라인 186-200)
if (opts.mcpServers && opts.mcpServers.length > 0) {
  const mcpServers = {};
  for (const mcp of opts.mcpServers) {
    if (mcp.type === 'local' && mcp.command) {
      mcpServers[mcp.id] = { command: mcp.command, args: mcp.args ?? [] };
    }
  }
  const mcpConfigPath = join(tmpdir(), `autodev-mcp-${Date.now()}.json`);
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }));
  args.push('--mcp-config', mcpConfigPath);
  // 종료 후 정리 (라인 280-282)
}
```

### 6.2 Codex CLI
**파일**: `src/lib/plugins/agents/codex-cli.ts`

**Prompt 슬라이싱 워크어라운드** (라인 25-30):
```typescript
// Codex CLI는 12K 글자 제한이 있음
const MAX_PROMPT_LENGTH = 12000;
let promptForCli = opts.task;
if (promptForCli.length > MAX_PROMPT_LENGTH) {
  opts.onProgress?.({ type: 'log', level: 'info', 
    message: `[Codex CLI] Truncating prompt from ${promptForCli.length} to ${MAX_PROMPT_LENGTH} chars` });
  promptForCli = promptForCli.slice(0, MAX_PROMPT_LENGTH) + '\n\n[... truncated for CLI length limit]';
}
```

**Exec 모드** (라인 32-43):
```typescript
const result = await execa(cliPath, [
  'exec',
  '--full-auto',              // ← 자동 진행 (사용자 입력 불필요)
  '--sandbox', 'workspace-write',  // ← CRITICAL: 쓰기 권한 필요
  '--json',                   // ← JSONL 형식 출력
  promptForCli,               // ← 프롬프트를 인자로 (stdin 아님)
], {
  cwd: opts.projectDir,
  timeout: opts.timeoutMs ?? 300_000,
  reject: false,
})
```

**JSONL 파싱 워크어라운드** (라인 76-131):
```typescript
// 역순으로 JSON 라인 탐색 (최신 결과부터)
const lines = result.stdout.trim().split('\n').filter(Boolean);
for (const line of lines.reverse()) {
  const parsed = JSON.parse(line);
  if (parsed.type === 'item.completed') {
    if (parsed.item?.type === 'agent_message' || parsed.item?.type === 'result') {
      resultText = parsed.item.text ?? resultText;
    }
  }
  if (parsed.result || parsed.text) {
    resultText = parsed.result ?? parsed.text ?? resultText;
    costUsd = parsed.cost_usd ?? 0;
    inputTokens = parsed.usage?.input_tokens ?? 0;
    outputTokens = parsed.usage?.output_tokens ?? 0;
    break;  // ← 첫 매치에서 중단
  }
}

// --json 실패 시 재시도 (라인 48-67)
if (parsed.modifiedFiles.length === 0 && result.exitCode === 0) {
  // 파일 없음 → --json 제거 후 재시도
}
```

### 6.3 Gemini CLI
**파일**: `src/lib/plugins/agents/gemini-cli.ts`

**간단한 JSON 호출** (라인 22-25):
```typescript
const result = await execa(cliPath, [
  '-p', opts.task,
  '--output-format', 'json',
  '-y',  // auto-approve
], {
  cwd: opts.projectDir,
  timeout: opts.timeoutMs ?? 300_000,
  reject: false,
})
```

**가격 추정** (라인 39-47):
```typescript
// Gemini 2.5 Pro 가격: $1.25/M input, $10.0/M output
// CLI가 정확한 사용량을 제공하지 않으므로 추정
const estimatedInput = Math.max(
  inputTokens,
  Math.ceil(opts.task.length / 4)  // 문자 ÷ 4 ≈ 토큰
);
const estimatedOutput = Math.max(
  outputTokens,
  Math.ceil(resultText.length / 4)
);
if (costUsd === 0 || costUsd < 0.0001) {
  costUsd = (estimatedInput / 1_000_000) * 1.25 + (estimatedOutput / 1_000_000) * 10.0;
}
```

---

## 7. Verify Agent 특화: Debug Dump & Cross-Model

### 7.1 Debug Dump (`~/.autodev/debug/`)

**Verify 프롬프트 저장** (라인 889-898):
```typescript
try {
  const debugDir = join(process.env.HOME ?? '/tmp', '.autodev', 'debug');
  mkdirSync(debugDir, { recursive: true });
  const ts = Date.now();
  writeFileSync(join(debugDir, `verify-prompt-${ts}.txt`), verifyPrompt, 'utf-8');
  emit({ type: 'log', level: 'info', 
    message: `[Verify] Debug prompt → ~/.autodev/debug/verify-prompt-${ts}.txt` });
} catch { /* non-critical */ }
```

**Verify 응답 저장** (라인 1049-1058):
```typescript
try {
  const debugDir = join(process.env.HOME ?? '/tmp', '.autodev', 'debug');
  mkdirSync(debugDir, { recursive: true });
  const ts = Date.now();
  writeFileSync(join(debugDir, `verify-response-${ts}.txt`), stdout, 'utf-8');
  emit({ type: 'log', level: 'info', 
    message: `[Verify] Debug response → ~/.autodev/debug/verify-response-${ts}.txt` });
} catch { /* non-critical */ }
```

### 7.2 Hallucination 대응 (Codex 특화)

**Codex JSONL 탐색 추출** (라인 1065-1091):
```typescript
if (this.llm === 'codex-cli' && stdout.length > 10000) {
  // Codex 탐색 모드에서 너무 많은 명령어 실행
  const findings = this.extractFindingsFromCodexJsonl(stdout, emit);
  if (findings) {
    if (findings.issues.length > 0) {
      // 합성 스코어 계산: 0 issues → 75, 1 → 65, 2 → 55, ...
      const synthScore = Math.max(45, 75 - findings.issues.length * 10);
      return { verifyResult: {...}, costUsd, tokenUsage };
    }
    throw new Error(`Codex exploration: ${findings.commandCount} cmds, no verdict`);
  }
}
```

**Hallucination 감지** (라인 1144-1155):
```typescript
if (this.llm === 'codex-cli' && this.fallbackLlms.length > 0) {
  const noCodePattern = /no (?:source|code|files|patch|diff)/i;
  const isHallucination = parsed.score === 0 && (
    noCodePattern.test(parsed.reason ?? '') ||
    (Array.isArray(parsed.issues) && parsed.issues.some(i => noCodePattern.test(i)))
  );
  if (isHallucination) {
    emit({ type: 'log', level: 'warn', 
      message: `[Verify] Codex hallucination (score=0, "no code") — retrying with ${this.fallbackLlms[0]}` });
    throw new Error('Codex hallucination: claimed no code despite prompt containing file contents');
  }
}
```

### 7.3 Cross-Model Fallback Chain

**LLM 자동 선택** (라인 44-68):
```typescript
static async selectDifferentFrom(codingAgentId: string) {
  // Codex 우선: 파일 읽으면서 심층 리뷰
  // Gemini CLI는 -p 모드에서 대형 프롬프트 시 승인 대기(hang)
  const candidates = ['codex-cli', 'gemini-cli', 'claude-cli'];
  const codingLlm = codingAgentId.replace('claude-code', 'claude-cli');
  
  const available: string[] = [];
  for (const candidate of candidates) {
    if (candidate === codingLlm) continue;
    const agent = new VerifyAgent(candidate);
    if (await agent.isAvailable()) {
      available.push(candidate);
    }
  }
  
  if (available.length === 0) {
    return { primary: new VerifyAgent('claude-cli'), fallbacks: [] };
  }
  return { primary: new VerifyAgent(available[0]), fallbacks: available.slice(1) };
}

// fallback 사용 (라인 1165-1175):
if (this.fallbackLlms && this.fallbackLlms.length > 0) {
  const nextLlm = this.fallbackLlms[0];
  emit({ type: 'log', level: 'info', 
    message: `[Verify] ${this.llm} failed, retrying with ${nextLlm}` });
  const fallbackAgent = new VerifyAgent(nextLlm);
  fallbackAgent.fallbackLlms = this.fallbackLlms.slice(1);
  return fallbackAgent.runLlmJudgment(input, evidence, emit);
}
```

---

## 8. Debate Mode 구조

### 8.1 4-Step 루프

**파일**: `src/agents/planning/debate-planner.ts`

```typescript
// 라운드당 4단계 (최대 2라운드):
// 1. Drafter: 초안 생성 (라인 57-79)
//    → generatePlan() 호출
//    → currentPlan 업데이트
//
// 2. Challenger: 적대적 공격 (라인 86-103)
//    → runChallenger(currentPlan, originalPrompt)
//    → 문제점 식별
//    → 문제 없으면 break (라인 100)
//
// 3. Drafter Revision: 문제 해결 (라인 105-134)
//    → runDrafterRevision(revisionPrompt)
//    → generatePlan() 재호출 (plan 수정)
//
// 4. Quality Checker: 3문서 비교 (라인 136-150)
//    → runQualityChecker(oldPlan, issues, newPlan, userPrompt)
//    → verdict: approved | revise | fail
//    → 최종 라운드 정보 저장

for (let round = 1; round <= MAX_DEBATE_ROUNDS; round++) {
  // ... 4 steps per round
  
  if (qcResult.verdict === 'approved') {
    break;
  } else if (qcResult.verdict === 'fail') {
    throw new Error(`Debate planning failed after ${round} rounds`);
  }
  // else: revise → 다음 라운드 진행
}
```

### 8.2 Private Helper 메서드들

**Challenger** (라인 155-200+):
```typescript
private async runChallenger(
  plan: Plan,
  originalPrompt: string,
  emit: (e: PipelineEvent) => void,
): Promise<{ issues: string[]; suggestions: string[]; costUsd: number }> {
  // 요약:
  // 1. 플랜만 보고 문제 찾기
  // 2. Gemini/Codex CLI 호출
  // 3. JSON 응답 파싱: { issues, suggestions }
  // 4. costUsd 반환
}
```

**Drafter Revision** (라인 200+):
```typescript
private async runDrafterRevision(
  revisionPrompt: string,
  emit: (e: PipelineEvent) => void,
): Promise<PlanResult> {
  // 요약:
  // 1. revisionPrompt로 generatePlan() 호출
  // 2. 수정된 plan 반환
  // 3. costUsd, tokens 포함
}
```

**Quality Checker** (라인 250+):
```typescript
private async runQualityChecker(
  oldPlan: Plan,
  issues: string[],
  newPlan: Plan,
  originalPrompt: string,
  emit: (e: PipelineEvent) => void,
): Promise<{ verdict: 'approved' | 'revise' | 'fail'; feedback: string; costUsd: number }> {
  // 요약:
  // 1. 3개 문서 비교: oldPlan, issues, newPlan
  // 2. Claude/Gemini CLI로 QC 평가
  // 3. verdict 결정
  // 4. feedback + costUsd 반환
}
```

### 8.3 Output 구조
```typescript
interface DebatePlanningOutput extends AgentOutput {
  result: {
    plan: Plan;                    // 최종 수용된 플랜
    rounds: DebateRound[];         // 각 라운드의 draft/challenge/revision/verdict
    totalRounds: number;           // 실제 실행한 라운드 수 (≤ MAX_DEBATE_ROUNDS)
    inputTokens: number;           // 누적 입력 토큰
    outputTokens: number;          // 누적 출력 토큰
  };
}
```

---

## 9. 복잡도 분석 & Wrap 난이도

### 9.1 Planning Agent
**복잡도**: 중간 (65줄 agent + 647줄 worker)

**전역 상태**: 없음 (순수 함수형)

**파일시스템 접근**: Minimal (prompt loading 정도)

**DB 접근**: 없음

**Wrap 난이도**: **하** (1-2시간)
- 이유:
  - 간단한 invoke() 시그니처
  - 워커 재사용 가능 (generatePlan)
  - onProgress 콜백 기존 지원
  - 부작용 최소

---

### 9.2 Coding Agent
**복잡도**: 높음 (59줄 wrapper + 297+134+50줄 backends)

**전역 상태**:
- `ClaudeCodeAgent.resolvedPath` (캐시)
- `CodexCliAgent.resolvedPath` (캐시)
- `resolveCli()` cache (라인 53, cli-resolver.ts)

**파일시스템 접근**:
- Claude Code SDK: None
- Claude Code CLI: tmpdir (MCP config) → 정리 (라인 280-282)
- Codex CLI: None
- Gemini CLI: None

**Wrap 난이도**: **중** (4-6시간)
- 이유:
  - 3개 백엔드 분기 처리 필요
  - SDK vs CLI 이중 경로 (Claude Code)
  - stream-json 파싱 복잡 (Claude Code CLI)
  - JSONL 추출 복잡 (Codex CLI)
  - CLI 경로 해석 (resolveCli)
  - MCP 서버 생성 & 정리
  - Modified files 추출 (getModifiedFiles)

**예상 소요**: 4-6시간
- 3개 백엔드 + 시그니처 맞춤: ~2시간
- 스트림 파싱 + 에러 처리: ~2시간
- 테스트 + 통합: ~1-2시간

---

### 9.3 Verify Agent
**복잡도**: 매우 높음 (1,641줄)

**전역 상태**:
- `VerifyAgent.fallbackLlms` (동적)

**파일시스템 접근** (광범위):
- `~/.autodev/debug/` (디버그 덤프)
- `~/.autodev/baselines/` (시각 회귀)
- `~/.autodev/screenshots/` (스크린샷)
- `~/.autodev/pbt/` (Property-Based Test)
- `~/.autodev/vlm-config.json` (VLM 설정 읽기)

**DB 접근**: 없음

**특수 기능**:
- MCP Playwright 도구 통합 (라인 234-250)
- Visual Regression (라인 309-331)
- 3-Stage 파이프라인 (mechanical/evidence/LLM)
- LLM 자동 선택 + Fallback (라인 44-68, 1165-1175)
- Hallucination 감지 (라인 1144-1155)
- Codex JSONL 탐색 추출 (라인 1194-1266)
- Property-Based Testing (라인 1268-1415)
- Visual analysis (VLM) (라인 1571-1640)
- Debate verification (라인 1418-1568)
- Acceptance criteria 검증 (라인 146-175)
- SAST 스캔 (라인 213-230)
- A11y 스캔 (라인 232-251)

**Wrap 난이도**: **상** (10-15시간)
- 이유:
  - 1,641줄 단일 파일 (분해 필요)
  - 8개 특수 검증 모듈 (PBT, VLM, A11y, SAST, Visual Regression, ...)
  - 3개 LLM + fallback chain
  - MCP 도구 깊은 통합
  - 3-stage 파이프라인 + 각 stage마다 emit()
  - Hallucination 대응 로직
  - Debug dump 인프라

**예상 소요**: 10-15시간
- 모듈 분해: ~2시간
- 3-stage 파이프라인 구조 유지: ~2시간
- LLM 백엔드 + fallback 처리: ~2시간
- 8개 특수 모듈 래핑: ~4시간
- 파일시스템 + 도구 통합: ~2시간
- 테스트 + 통합: ~2-3시간

---

### 9.4 Debate Mode
**복잡도**: 중간-높음 (470줄)

**전역 상태**: `DebatePlanner.cliMode`

**파일시스템 접근**: 없음 (하위 generatePlan 워커 재사용)

**Wrap 난이도**: **중** (4-8시간)
- 이유:
  - 4-step 루프 구조 명확
  - Private helper 3개 (Challenger, Revision, QC)
  - 각 step에서 LLM 호출 (generatePlan 재사용)
  - 라운드별 비용 누적
  - JSONL 파싱 (각 step마다)

**예상 소요**: 4-8시간
- 루프 구조 유지: ~1시간
- 3개 helper 메서드: ~2시간
- 라운드 관리 + 누적: ~1시간
- JSON 응답 파싱: ~1시간
- 테스트: ~1-2시간

---

## 10. 조사 중 발견한 예상 밖 이슈/리스크

### 10.1 CLI 경로 해석 복잡성
**문제**: `resolveCli()` (`src/lib/cli-resolver.ts`) 캐시가 전역 변수
```typescript
// 라인 53: const resolveCache = new Map<string, string | null>();

// 캐시는 프로세스-전역
// → 테스트 중 캐시 정리 필요
// → clearCliCache() 제공 (라인 102)
```

**영향**: Wrapper에서 각 agent 인스턴스가 resolveCli() 호출 시 캐시 공유 → 문제없지만 테스트 시 주의

---

### 10.2 Claude Code SDK vs CLI 이중 경로 불안정성
**문제**: ClaudeCodeAgent는 SDK 우선, CLI 폴백 (라인 72-81)
```typescript
try {
  return await this.invokeViaSdk(opts);
} catch (sdkError) {
  opts.onProgress?.({ type: 'log', level: 'warn', message: `... falling back to CLI` });
  return await this.invokeViaCli(opts);
}
```

**리스크**:
- SDK 부분 실패 시 전체 결과 손실
- 토큰 사용량 카운팅 부정확 (SDK 시작 후 CLI로 전환)
- MCP 설정 2번 생성 가능

---

### 10.3 Codex CLI Prompt 슬라이싱 silent failure
**문제**: 프롬프트가 12K를 초과하면 자동 자르기 (라인 27-30)
```typescript
if (promptForCli.length > MAX_PROMPT_LENGTH) {
  promptForCli = promptForCli.slice(0, MAX_PROMPT_LENGTH) 
    + '\n\n[... truncated for CLI length limit]';
}
```

**리스크**:
- 자른 프롬프트로 완전한 플랜 불가능
- 에러 없음 (exit code 0이라도)
- 사용자가 모름 (경고만 emit)

---

### 10.4 Verify Agent 파일시스템 오염
**문제**: 검증 과정에서 여러 임시 디렉토리 생성
- `~/.autodev/debug/` (프롬프트 + 응답)
- `~/.autodev/baselines/` (시각 회귀 베이스라인)
- `~/.autodev/screenshots/` (스크린샷)
- `~/.autodev/pbt/` (Property-Based Test)
- `~/.autodev/vlm-config.json` (VLM 설정)

**리스크**:
- 홈 디렉토리 오염 (프로젝트 외부)
- 정리 로직 부분적 (mkdirSync + try-catch로 soft fail)
- 용량 증가 가능 (스크린샷)

---

### 10.5 Verify Agent LLM Fallback Chain 모호성
**문제**: selectDifferentFrom() 로직 (라인 44-68)
```typescript
const candidates = ['codex-cli', 'gemini-cli', 'claude-cli'];
const codingLlm = codingAgentId.replace('claude-code', 'claude-cli');

// 코딩 에이전트가 'claude-code'이면 → 'claude-cli' 제외
// 검증은 다른 LLM 선택
// BUT: 우선순위 Codex > Gemini > Claude는 고정
```

**리스크**:
- 코딩: Claude → 검증: Codex (완전히 다른 모델)
- 코딩: Codex → 검증: Gemini
- 비용 예측 불가

---

### 10.6 Debate Mode 비용 누적 폭발
**문제**: MAX_DEBATE_ROUNDS = 2 (라인 28)이지만 각 라운드마다 3-4번 LLM 호출
```
라운드 1:
  - Drafter: generatePlan() → CLI 호출 (평가: $0.1+)
  - Challenger: runChallenger() → CLI 호출 ($0.05+)
  - Revision: runDrafterRevision() → CLI 호출 ($0.1+)
  - QC: runQualityChecker() → CLI 호출 ($0.05+)
  = 라운드당 ~$0.3-0.5

라운드 2:
  = 또 $0.3-0.5

총 ~$0.6-1.0 (debate 플래그만으로)
```

**리스크**:
- 사용자 예상 외 비용 증가
- 비용 제한 없음 (maxBudgetUsd 미검사)

---

### 10.7 Codex JSONL 탐색 추출 휴리스틱
**문제**: extractFindingsFromCodexJsonl() (라인 1194-1266)
```typescript
// 정규식 기반 휴리스틱으로 탐색 메시지에서 이슈 추출
const issuePatterns = /\b(defect|bug|error|vulnerability|...)\b/i;
const planningPrefix = /^\s*(I'll|I will|Let me|...)\b/i;
const investigationVerbs = /\b(inspect|check|look at|...)\b/i;

// 문제:
// 1. 정규식으로 의미 판단 (오류 가능)
// 2. 영어 중심 (한국어 지원 약함)
// 3. Sentence split = /[.!]\s+/ (부정확)
```

**리스크**:
- False positive/negative 발생 가능
- Codex 탐색이 무한 반복되면 timeout → 부분 JSONL 파싱 → 휴리스틱 추출 → 정확도 저하

---

### 10.8 VLM Vision 이미지 손실
**문제**: analyzeVisual() (라인 1571-1640)에서 OpenRouter API 호출
```typescript
// image 데이터 → base64 → HTTP POST
// → 네트워크 실패 시 전체 verify 실패 가능

// 또한: OPENROUTER_API_KEY 필수
// → 없으면 throw new Error('VLM requires OPENROUTER_API_KEY')
```

**리스크**:
- VLM 외부 의존성 (API 호출)
- 네트워크 지연 → 검증 전체 지연
- API 키 부재 시 검증 실패

---

### 10.9 Acceptance Criteria 경로 traversal 처리
**문제**: 라인 154-166에서 path traversal 체크
```typescript
for (const f of ac.requiredFiles as string[]) {
  const absPath = resolve(absProjectDir, f);
  if (!absPath.startsWith(absProjectDir + '/') && absPath !== absProjectDir) {
    acFails.push(`Required file path escapes project directory: ${f}`);
    continue;
  }
```

**주의점**:
- `absProjectDir + '/'` 문자열 비교 (symlink 고려 안함)
- Windows: `/` vs `\` 문제
- resolve() 정규화 후 체크하므로 기본적으로 안전

---

### 10.10 Stream JSON 파싱 선행 버퍼 처리
**문제**: Claude Code CLI (라인 223-262) stream-json 파싱
```typescript
buffer += chunk.toString();
const lines = buffer.split('\n');
buffer = lines.pop() ?? '';  // ← 마지막 불완전 라인 유지

for (const line of lines) {
  // 각 라인은 완전한 JSON
}

// 위험: 마지막 버퍼에 JSON이 남을 수 있음 (프로세스 종료 전 처리 안됨)
```

**영향**:
- 마지막 JSON 이벤트 손실 가능
- 최종 result 이벤트가 버퍼에 남으면 costUsd/tokenUsage 못 읽음
- 하지만 프로세스 'close' 이벤트 (라인 264) 후 fullStdout 재처리 (라인 266-277)로 부분 복구

---

## 권장사항: Wrap 전략 순서

1. **Planning Agent** (하 난이도): 1-2시간 → 기초 체계 확립
2. **Debate Mode** (중 난이도): 4-8시간 → Planning 재사용
3. **Coding Agent** (중 난이도): 4-6시간 → 3개 백엔드 통합
4. **Verify Agent** (상 난이도): 10-15시간 → 마지막 (복잡도 높음)

**wrap 시 주의사항**:
- CLI 경로 해석: resolveCli() 캐시 정리 (테스트)
- SDK vs CLI: 이중 경로 트랜잭션 처리
- Codex 프롬프트: 12K 자르기 silent failure 처리
- 파일시스템: 임시 디렉토리 정리 (verify-agent)
- VLM: 외부 API 의존성 처리
- Cost tracking: Debate 비용 누적 모니터링
