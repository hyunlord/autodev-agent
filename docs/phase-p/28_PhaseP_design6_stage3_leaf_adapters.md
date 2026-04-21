# Phase P 설계 6 — Stage 3 Leaf Adapters 구현 블루프린트

> 작성: 2026-04-21 (Phase P 설계 시리즈 15번째, Stage 2 종결 후)
> 선행: 설계 4B1 (agent) + 4B4 (action) + 로드맵 v7 Stage 3 섹션
> 목적: Stage 2에서 확정된 Adapter 인터페이스에 **실제 구현체를 붙이기 위한 "구현자 관점" 재구성**
> 대상 독자: Stage 3 Week 7 시작 직전의 Claude Code 프롬프트 작성자
> 범위: 4 leaf adapters (agent / shell / http / webhook_out) + Facade + Shadow 모드

---

## 0. 이 문서의 목적과 위치

### 0.1 왜 별도 문서인가?

설계 4B1 (agent) 과 4B4 (action) 는 **언어 스펙 관점**의 완전한 문서다. 파이프라인 작성자가 YAML 을 쓸 때 참조하는 reference manual. 반면 이 문서는 **엔진 구현자 관점**의 재구성이다.

- 4B1/4B4 는 "agent 노드는 어떤 필드를 가진다" 를 정의
- 이 문서는 "adapter 클래스는 어떤 파일 구조에서, 어떤 기존 코드를 호출하며, Stage 2 Executor 와 어떻게 연결되는가" 를 정의

반복하지 않고 **링크한다**. 4B1 이 이미 100 줄을 할애한 것을 이 문서가 다시 쓰지 않는다.

### 0.2 Stage 2 의 산출물 (입력)

Stage 3 이 시작되는 시점에 이미 존재하는 것:

```
src/lib/adpl/
├── compiler/           # YAML → AST → Scheduler-ready graph
├── engine/
│   ├── executor.ts     # PipelineExecutor.run()
│   ├── scheduler.ts    # 노드 의존성 → 실행 큐
│   ├── worker.ts       # 노드 단위 실행 담당
│   └── adapters/
│       ├── types.ts    # Adapter 인터페이스 (확정)
│       └── mock.ts     # 8 시나리오 검증에 쓴 mock
└── state/              # Checkpoint 저장
```

**Stage 3 는 `adapters/` 아래에 실제 구현체 4 개를 추가하는 작업이다**. Stage 2 의 executor/scheduler/worker 는 건드리지 않는다.

### 0.3 Stage 3 의 비목표

명시적으로 **하지 않는 것**:

| 항목 | 이유 | 언제? |
|------|------|------|
| `mcp` adapter | 외부 의존성 복잡, v1 유보 | v1.5+ |
| 읽기/쓰기/git 전용 adapter | shell 로 충분히 커버 | 영구 (설계 결정) |
| Flow adapter (branch, parallel, loop) | Stage 4 범위 | Stage 4 |
| Trigger (task_created, schedule) | Stage 5 범위 | Stage 5 |
| Expression evaluator 고도화 | 기본형만 Stage 2 에서 완성 | Stage 5 |
| AgentAdapter 2-레이어 심화 추상화 | 일단 얕은 추상으로 Stage 3 종료, 검증 후 심화 | Stage 7 |
| Verify Agent **전체** wrap (8 특수 모듈 포함) | C7-1 조사 결과 1,641줄 + PBT/VLM/A11y/SAST/Visual Regression, 10-15시간 소요 | **C7-1.5 별도 작업** (Week 7 내 또는 Week 8 초) |
| Debate Mode wrap (Drafter/Challenger/QC) | role 개념 자체가 Stage 4 flow (branch/loop) 없이는 어색 | Stage 4 |

### 0.4 로드맵 v7 와의 관계

로드맵 v7 §4 Stage 3 (Week 7-9) 의 작업 분해 (C7-1, C7-2, C8-1, C9-1 등) 가 **외곽 스케줄**이고, 이 문서가 **각 작업의 구현 blueprint** 다. Claude Code 프롬프트 작성 시:

```
1. 로드맵 v7 §4 에서 이번 주 작업 번호 확인 (예: C7-1)
2. 이 문서에서 해당 번호의 "구현 상세" 섹션 읽기 (예: §3 전체)
3. 4B1/4B4 의 필드 레퍼런스 필요하면 링크 따라 점프
4. 프롬프트 작성
```

---

## 1. Stage 3 범위 경계 & 핵심 결정

### 1.1 Leaf Adapter = 4 개 (재확인)

```
agent         ← 설계 4B1
shell         ← 설계 4B4 §2
http          ← 설계 4B4 §3
webhook_out   ← 설계 4B4 §4 (http 위에 얇게)
```

**mcp 제외 근거**: Stage 3 의 Exit 기준은 "legacy-equivalent 파이프라인 실행" 이다. 현재 AutoDev legacy 파이프라인은 Plan → Code → Verify 가 전부이며 MCP 를 사용하지 않는다. mcp adapter 는 Shadow 검증에 기여하지 않고, 디버깅 surface 만 늘린다.

### 1.2 흡수 전략 (read_file / write_file / git / hook)

로드맵 v7 §4.2 C7-3 에 명시: **Hook 시스템은 Shell adapter 로 흡수**. 연장선에서:

| legacy 개념 | Stage 3 대응 |
|-------------|------------|
| pre-verify hook, post-verify hook | `shell` 노드 + `when` 조건 |
| `git diff`, `git add` 등 git 조작 | `shell: git diff --cached` |
| 파일 읽기 (verify input 로딩) | `shell: cat path` + `outputFormat: text` |
| 파일 쓰기 (artifact 저장) | agent adapter 내부 artifact 저장 로직에 위임 |
| pre-commit hook enforcement (H5) | `shell` 노드 + policy allowlist + Stage 4 `gate` 로 완성 |

**핵심**: 신규 adapter 를 만들지 않는 것 자체가 설계 결정이다. ADPL 의 Unix 철학 — "shell 이 있으면 그걸로 조합해라".

### 1.3 Agent adapter 추상화 깊이 — Stage 3 은 "얕게"

Stage 3 범위 논의에서 확정: 추상화 레이어는 만들되 **2 단계 심화(AgentAdapter → LLMBackend) 는 Stage 7 로 이월**. Stage 3 의 agent adapter 는:

```
AgentAdapter (인터페이스)
├── AutoDevAgentAdapter  ← 기존 Planning/Coding/Verify 재사용
├── ClaudeCodeAdapter     ← claude CLI 직접 호출
├── GeminiCLIAdapter      ← gemini CLI 직접 호출
└── CodexCLIAdapter       ← codex CLI 직접 호출 (stdin 슬라이싱 포함)
```

role (planner/coder/verifier) × model 조합은 **YAML 레벨에서 해결**. adapter 코드 내에서 분기하지 않는다. Stage 3 에 포함되는 role 은 **planner / coder / verifier 3 개만**. Debate role (drafter/challenger/quality-checker) 은 Stage 4 (flow adapter) 와 함께 정의하는 것이 자연스러움.

이유:

- Stage 3 에서는 실제 사용 조합이 5~6 개로 제한됨 (legacy-equivalent)
- 2 단계 추상화는 "자기합리화 방지 enforcement" 로직(coder ≠ verifier LLM 강제) 을 adapter 레벨로 끌어올리는 것인데, 현재는 Validation 레이어에서 충분히 걸림
- 추상화 레이어를 늘리면 Stage 3 Exit 기준(Shadow diff < 30%) 달성 전에 구조 디버깅으로 시간을 소모

**Stage 7 재평가 트리거**: adapter 구현체가 5 개를 넘거나, 같은 role 을 다른 model 로 swap 하는 YAML 이 실사용에서 3 개 이상 등장.

### 1.4 기존 자산 재활용 — "wrapping, not porting"

현재 레포에 있는 자산:

- Planning Agent (system prompt + executor)
- Coding Agent (Claude Code / Codex CLI / Gemini CLI 래핑 포함)
- Verify Agent (cross-model 검증 로직, ~/.autodev/debug/ dump)
- Debate Mode (Drafter → Challenger → Quality Checker)
- Playwright CSS 기계적 체크
- Cost tracker (H2 Cost Dashboard)
- Memory system (G3 persistent memory)

**Stage 3 원칙**: 이들을 **포팅하지 않고 감싼다(wrap)**. `AutoDevAgentAdapter` 는 기존 executor 를 호출하는 얇은 어댑터일 뿐, 로직을 재작성하지 않는다.

Stage 3 이후 (Stage 7 또는 별도 단계에서) 기존 코드를 ADPL 네이티브로 포팅할지 결정한다. 지금은:

```
[ADPL YAML]
    ↓ compile
[Stage 2 Executor]
    ↓ execute node
[AutoDevAgentAdapter.execute()]
    ↓ call (shim)
[legacy agent executor]  ← 기존 코드, 건드리지 않음
    ↓ return artifact
[AutoDevAgentAdapter adapter result]
    ↓
[Stage 2 Executor]
```

### 1.5 Layer 1 = Layer 2 symmetry 확인

Stage 3 adapter 들은 Layer 1 (AutoDev 자체 개발) 에서도 그대로 쓰여야 한다. 구체적으로:

- Layer 2 task → YAML → adapter 4 개 → 결과
- Layer 1 task (Debate Mode for Layer 1 등 계획된 기능) 도 동일한 YAML → 동일한 adapter → 결과

이 대칭이 깨지면 안 된다. 구현 시 체크 포인트:

- [ ] adapter 는 "Layer 1 전용 입력" 을 특별 취급하지 않는다
- [ ] Debate Mode 로직도 YAML (`branch` + 여러 `agent` 노드) 로 표현 가능해야 한다
- [ ] agent adapter 의 input/output 은 Layer 1/2 무관하게 동일 스키마

**Stage 3 에서 실제 Layer 1 YAML 을 작성하지는 않는다** (Stage 4 의 flow adapter 필요). 다만 "불가능하지 않은" 설계를 확인하는 것이 Stage 3 책임.

---

## 2. Adapter 공통 인터페이스 (Stage 2 recap)

> Stage 2 에서 이미 확정된 것. 이 섹션은 recap 이며, 변경하지 않는다.

### 2.1 인터페이스 형태

```typescript
// src/lib/adpl/engine/adapters/types.ts (Stage 2 산출물)

export interface NodeAdapter<TSpec extends NodeSpec = NodeSpec> {
  readonly type: string;  // 'agent' | 'shell' | 'http' | 'webhook_out'

  execute(
    spec: TSpec,
    ctx: ExecutionContext
  ): AsyncIterable<AdapterEvent> | Promise<AdapterResult>;

  cancel?(runId: string): Promise<void>;

  validate?(spec: TSpec): ValidationResult;
}

export interface ExecutionContext {
  runId: string;
  nodeId: string;
  projectId: string;
  worktreeRoot: string;
  env: Record<string, string>;
  $: ExpressionScope;         // $nodes, $trigger, $project 등
  abortSignal: AbortSignal;
  emit(event: AdapterEvent): void;
  checkpoint(state: unknown): Promise<void>;
}

export type AdapterEvent =
  | { type: 'started'; at: string }
  | { type: 'progress'; data: unknown }
  | { type: 'token'; text: string }       // agent streaming
  | { type: 'log'; level: LogLevel; msg: string }
  | { type: 'completed'; result: AdapterResult };

export interface AdapterResult {
  ok: boolean;
  output: NodeOutput;
  error?: AdapterError;
  metrics: NodeMetrics;
}
```

### 2.2 Adapter 가 **하지 않는** 것

- 의존성 해결 → Scheduler 담당
- 재시도 제어 → Worker 담당 (policy 해석만 adapter)
- Checkpoint 저장 → Worker 가 `ctx.checkpoint()` 호출
- 상태 전이 기록 → Executor 담당

adapter 는 **"한 노드의 한 번 실행"** 에만 책임을 진다.

### 2.3 등록 방식

```typescript
// src/lib/adpl/engine/adapters/registry.ts (Stage 2 에 존재)

export function registerAdapter(adapter: NodeAdapter): void;
export function getAdapter(type: string): NodeAdapter;
```

Stage 3 에서 각 adapter 는 레지스트리에 등록되며, Executor 는 노드 타입으로 조회하여 실행한다. 순서 의존성 없음.

---

## 3. Agent Adapter (C7-1)

> 4B1 원본 스펙: `15_PhaseP_design4a_pipeline_language.md` 및 `16_PhaseP_design4b1_agent.md` 참조
> Stage 3 범위: §1.3 의 "얕은 추상" + §1.4 의 "wrapping"

### 3.1 파일 구조

```
src/lib/adpl/engine/adapters/agent/
├── index.ts              # NodeAdapter 구현체 (진입점)
├── resolver.ts           # role + model → 구체 adapter 결정
├── backends/
│   ├── autodev.ts        # AutoDevAgentAdapter (기존 Planning/Coding/Verify wrap)
│   ├── claude-code.ts    # ClaudeCodeAdapter (claude CLI)
│   ├── gemini-cli.ts     # GeminiCLIAdapter
│   └── codex-cli.ts      # CodexCLIAdapter (stdin 슬라이싱 포함)
├── input-transform.ts    # AgentNodeSpec → legacy agent input
├── output-transform.ts   # legacy result → NodeOutput
├── streaming.ts          # token 이벤트 생성
└── __tests__/
    ├── autodev.test.ts
    ├── claude-code.test.ts
    ├── gemini-cli.test.ts
    ├── codex-cli.test.ts
    └── integration.test.ts
```

### 3.2 진입점 로직

```typescript
// src/lib/adpl/engine/adapters/agent/index.ts

import { NodeAdapter, AdapterResult, ExecutionContext } from '../types';
import { resolveBackend } from './resolver';
import { transformInput } from './input-transform';
import { transformOutput } from './output-transform';

export const agentAdapter: NodeAdapter<AgentNodeSpec> = {
  type: 'agent',

  async *execute(spec, ctx) {
    yield { type: 'started', at: new Date().toISOString() };

    // 1. backend 선택
    const backend = resolveBackend(spec.role, spec.model);

    // 2. input 변환 (ADPL spec → legacy agent input)
    const legacyInput = transformInput(spec, ctx);

    // 3. 실행 (backend 는 자체 streaming 을 yield)
    for await (const event of backend.run(legacyInput, ctx)) {
      yield event;
    }

    // 4. output 변환 및 반환은 backend 의 'completed' 이벤트에서 이미 처리
  },

  async cancel(runId) {
    // 각 backend 의 cancel 호출 — 상세는 backend 별
  },

  validate(spec) {
    // role, model 조합 유효성, useMemory 제약 등
  },
};
```

### 3.3 Resolver: role × model 매핑

자기합리화 방지 원칙(§메모리: coder ≠ verifier LLM)은 이미 기존 코드에 구현되어 있다. `src/lib/agents/verify-agent.ts` 의 `selectDifferentFrom()` (라인 44-68) 이 coder 와 다른 LLM 을 동적으로 선택한다. **Stage 3 의 Resolver 는 이 로직을 침범하지 않는다** — 단순 validator 역할만 한다.

```typescript
// src/lib/adpl/engine/adapters/agent/resolver.ts

type Role = 'planner' | 'coder' | 'verifier';  // Stage 3 범위: 3 role
type Model =
  | 'autodev-internal'       // 기존 executor wrapping
  | 'claude-code'            // claude CLI
  | 'gemini-cli'             // gemini CLI
  | 'codex-cli'              // codex CLI
  | 'auto-cross-model';      // verifier 전용: coder 와 다른 LLM 동적 선택

// Stage 3 의 허용 매트릭스
const ROLE_MODEL_MATRIX: Record<Role, Model[]> = {
  planner:  ['autodev-internal', 'claude-code', 'gemini-cli', 'codex-cli'],
  coder:    ['autodev-internal', 'claude-code', 'gemini-cli', 'codex-cli'],
  verifier: ['autodev-internal', 'auto-cross-model', 'gemini-cli', 'codex-cli', 'claude-code'],
  //                             ^^^^^^^^^^^^^^^^^ 기본값, selectDifferentFrom 위임
};

export function resolveBackend(role: Role, model: Model, ctx: ExecutionContext): AgentBackend {
  const allowed = ROLE_MODEL_MATRIX[role];
  if (!allowed.includes(model)) {
    throw new ValidationError(
      `Role '${role}' cannot use model '${model}'. Allowed: ${allowed.join(', ')}`
    );
  }

  // verifier + auto-cross-model → coder 의 실제 model 조회 후 다른 것 선택
  if (role === 'verifier' && model === 'auto-cross-model') {
    const coderModel = ctx.$.resolve('$nodes.code.model') as Model | undefined;
    return new AutoDevAgentBackend({ crossModelBase: coderModel });
    // AutoDevAgentBackend 내부에서 기존 selectDifferentFrom 호출
  }

  // 그 외: model 명시된 backend 직접 반환
  return createBackend(model);
}
```

**주의**:
- `claude-code` 를 verifier 에도 허용하는 것은 명시 사용자 override 용이다. 기본값(`auto-cross-model`) 이 coder 와 다른 LLM 을 고르므로 자기합리화 방지는 지켜진다.
- Stage 3 에서 **evaluator role 은 reserved** — validate 단계에서 거부. 이유: 메모리 기록 ("evaluator 는 reserved 역할, UI disabled + 서버 가드 패턴").

### 3.4 Backend 공통 인터페이스

```typescript
// src/lib/adpl/engine/adapters/agent/backends/types.ts

export interface AgentBackend {
  readonly id: Model;

  run(
    input: LegacyAgentInput,
    ctx: ExecutionContext
  ): AsyncIterable<AdapterEvent>;

  cancel(runId: string): Promise<void>;
}

export interface LegacyAgentInput {
  role: Role;
  prompt: string;              // 이미 harness 가 조립한 최종 prompt
  systemPrompt: string;
  context: {
    memoryBlock?: string;      // G3 persistent memory
    planArtifact?: unknown;    // coder 에게 주입
    codeArtifact?: unknown;    // verifier 에게 주입
    projectState?: unknown;
  };
  constraints: {
    timeout: number;
    maxTokens?: number;
    tools?: string[];          // allowlist
  };
}
```

각 backend 는 이 input 을 받아서 자기 방식대로 실행한다.

### 3.5 AutoDevAgentAdapter (기존 자산 wrapping)

```typescript
// src/lib/adpl/engine/adapters/agent/backends/autodev.ts

import { runPlanningAgent } from '@/lib/agents/planning';
import { runCodingAgent } from '@/lib/agents/coding';
import { runVerifyAgent } from '@/lib/agents/verify';

export class AutoDevAgentBackend implements AgentBackend {
  readonly id = 'autodev-internal';

  async *run(input, ctx) {
    const runner = this.pickRunner(input.role);

    // 기존 agent 는 EventEmitter 기반 — AsyncIterable 로 어댑팅
    const iter = adaptEventEmitterToAsyncIterable(
      runner({
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        ...input.context,
        abortSignal: ctx.abortSignal,
      })
    );

    for await (const ev of iter) {
      // 기존 'chunk' 이벤트 → 'token' 으로 normalize
      if (ev.type === 'chunk') {
        yield { type: 'token', text: ev.text };
      } else if (ev.type === 'done') {
        yield {
          type: 'completed',
          result: {
            ok: true,
            output: this.normalizeOutput(ev.artifact, input.role),
            metrics: ev.metrics,
          },
        };
      }
    }
  }

  private pickRunner(role: Role) {
    switch (role) {
      case 'planner':  return runPlanningAgent;
      case 'coder':    return runCodingAgent;
      case 'verifier': return runVerifyAgent;
      default: throw new Error(`autodev backend does not support role '${role}'`);
    }
  }
  // ...
}
```

**포인트**: `runPlanningAgent` 등 기존 함수는 **건드리지 않는다**. adapter 는 입력 변환 + 이벤트 정규화만 한다.

**전역 상태 주의 (보고서 10.1 반영)**: 기존 `ClaudeCodeAgent.resolvedPath`, `CodexCliAgent.resolvedPath`, `resolveCli()` 캐시는 **프로세스 전역**이다. Adapter 인스턴스를 여러 개 만들어도 캐시는 공유된다. 문제:

- 테스트 간 격리가 안 됨 → `clearCliCache()` 를 테스트 `beforeEach` 에 호출 필요
- 런타임에 CLI 경로가 바뀌면(예: nvm 전환) invalidate 수단 필요
- adapter 에서 caching 레이어를 추가하지 **말 것** (기존 캐시와 중복)

Stage 3 에서는 캐시 구조 자체를 건드리지 않고, 테스트 유틸만 제공:

```typescript
// src/lib/adpl/engine/adapters/agent/__tests__/helpers.ts
import { clearCliCache } from '@/lib/cli-resolver';

export function setupCleanCli() {
  beforeEach(() => clearCliCache());
}
```

### 3.6 ClaudeCodeAdapter (CLI 직접 호출)

```typescript
// src/lib/adpl/engine/adapters/agent/backends/claude-code.ts

export class ClaudeCodeBackend implements AgentBackend {
  readonly id = 'claude-code';

  async *run(input, ctx) {
    const args = ['--print', '--output-format', 'stream-json'];
    // 긴 prompt 는 stdin 으로 (codex 와 동일 워크어라운드를 claude 에도 선제 적용)
    const child = spawn('claude', args, {
      cwd: ctx.worktreeRoot,
      env: { ...ctx.env },
      signal: ctx.abortSignal,
    });

    child.stdin.write(this.buildStdinPayload(input));
    child.stdin.end();

    for await (const line of readLines(child.stdout)) {
      const msg = JSON.parse(line);
      if (msg.type === 'assistant_text') {
        yield { type: 'token', text: msg.text };
      } else if (msg.type === 'completion') {
        yield {
          type: 'completed',
          result: {
            ok: msg.exitCode === 0,
            output: this.parseArtifact(msg, input.role),
            metrics: { tokens: msg.usage, durationMs: msg.duration },
          },
        };
      }
    }
  }
  // ...
}
```

**SDK → CLI 폴백 처리 (보고서 10.2 반영)**: 기존 `ClaudeCodeAgent` 는 SDK 우선, 실패 시 CLI 폴백으로 이중 경로다. 문제:

- SDK 가 토큰 스트리밍 **도중** 실패하면 부분 결과 + CLI 전환 → 토큰 카운팅 부정확
- MCP 설정 2 번 생성 가능
- AdapterEvent 의 `completed` 가 한 번만 emit 되어야 하는 원칙 위반 가능

Stage 3 대응:
- 폴백 발생 시 `metrics.backendFallback = true` 플래그
- SDK 시도에서 emit 된 `token` 이벤트는 **폐기 표시**: `progress` 이벤트 `{ kind: 'backend-fallback', discardedTokens: N }` 전송
- 토큰 비용은 CLI 측 최종값만 기록, SDK 부분은 별도 `metrics.sdkAttemptTokens` 에 참고용으로만

```typescript
let sdkTokens = 0;
try {
  for await (const ev of sdkStream) {
    if (ev.type === 'token') { sdkTokens += estimate(ev.text); yield ev; }
    // ...
  }
} catch (sdkErr) {
  ctx.emit({
    type: 'progress',
    data: { kind: 'backend-fallback', from: 'sdk', to: 'cli', discardedTokens: sdkTokens }
  });
  yield* this.runViaCli(input, ctx);  // CLI 에서만 final metrics 카운팅
}
```

### 3.7 CodexCLIAdapter — stdin 슬라이싱 워크어라운드

메모리에 명시: Codex CLI 의 `-p` 인자는 긴 prompt 에서 깨진다. Stage 3 에서 **이 워크어라운드는 backend 내부로 숨긴다** — 사용자/YAML 작성자는 신경 쓰지 않는다.

```typescript
// src/lib/adpl/engine/adapters/agent/backends/codex-cli.ts

const CODEX_STDIN_CHUNK = 4000;  // 경험적 안전값

export class CodexCLIBackend implements AgentBackend {
  readonly id = 'codex-cli';

  async *run(input, ctx) {
    const child = spawn('codex', ['--stdin'], {
      cwd: ctx.worktreeRoot,
      env: ctx.env,
      signal: ctx.abortSignal,
    });

    // 슬라이스 단위로 write
    const payload = this.buildStdinPayload(input);
    for (let i = 0; i < payload.length; i += CODEX_STDIN_CHUNK) {
      child.stdin.write(payload.slice(i, i + CODEX_STDIN_CHUNK));
      await new Promise(r => setImmediate(r));  // backpressure 양보
    }
    child.stdin.end();

    // ... stdout 처리
  }
  // ...
}
```

**12K prompt slicing silent failure 승격 (보고서 10.3 반영)**: 기존 코드는 `MAX_PROMPT_LENGTH` 초과 시 자동 slice + `[... truncated]` 접미사 + warning log 만 emit 한다. 문제는 **silent** — exit code 0, 사용자 모름, 결과 품질만 저하.

Stage 3 대응 (기존 slicing 로직은 건드리지 않고 adapter 레이어에서 승격):

```typescript
const originalLength = payload.length;
if (originalLength > MAX_PROMPT_LENGTH) {
  ctx.emit({
    type: 'progress',
    data: {
      kind: 'prompt-truncated',
      original: originalLength,
      kept: MAX_PROMPT_LENGTH,
      severity: 'warning',
    }
  });
  metrics.promptTruncated = true;
  metrics.promptOriginalLength = originalLength;
}
```

Verify Agent 가 `metrics.promptTruncated === true` 인 node 의 output 을 평가할 때는 **score 상한 캡** 적용 (Stage 3 에서 85/100 권고). 이유: truncation 은 품질 저하 확정.

### 3.8 GeminiCLIAdapter + debug dump + 홈 디렉토리 리디렉션

Verify Agent hallucination 조사를 위해 메모리에 명시된 `~/.autodev/debug/` dump 기능은 **backend 레벨** 에서 유지:

```typescript
// src/lib/adpl/engine/adapters/agent/backends/gemini-cli.ts

export class GeminiCLIBackend implements AgentBackend {
  async *run(input, ctx) {
    const debugPath = resolveDebugPath(ctx.runId, ctx.nodeId);

    // Input dump (pre-run)
    await fs.writeFile(`${debugPath}/input.json`, JSON.stringify(input, null, 2));

    try {
      // ... CLI 호출
      yield* this.streamFromCLI(child, input, ctx);
    } finally {
      // Output dump (post-run, 실패 시에도)
      await fs.writeFile(`${debugPath}/output.json`, JSON.stringify(lastResult, null, 2));
    }
  }
}
```

**결정**: debug dump 는 verifier role 에만 활성화 (기본). 다른 role 도 켤 수 있지만 용량 때문에 opt-in. ADPL 에서는 노드의 `trace: deep` 필드로 제어.

**홈 디렉토리 오염 대응 (보고서 10.4 반영)**: 기존 Verify Agent 는 `~/.autodev/` 아래 **5 종** 디렉토리를 사용한다:

| 디렉토리 | 용도 | Stage 3 정책 |
|---------|------|-------------|
| `~/.autodev/debug/` | 프롬프트/응답 dump | **유지** (사용자 홈이 의미 있음 — 전역 디버깅) |
| `~/.autodev/baselines/` | Visual regression baseline | **프로젝트 내부 이동**: `<worktreeRoot>/.autodev/baselines/` |
| `~/.autodev/screenshots/` | 테스트 스크린샷 | **프로젝트 내부 이동**: `<worktreeRoot>/.autodev/screenshots/` |
| `~/.autodev/pbt/` | Property-Based Test 결과 | **프로젝트 내부 이동**: `<worktreeRoot>/.autodev/pbt/` |
| `~/.autodev/vlm-config.json` | VLM 설정 읽기 | **유지** (사용자 전역 설정) |

근거:
- baselines/screenshots/pbt 는 **프로젝트별 데이터**. 홈에 두면 프로젝트 전환 시 오염.
- Phase P 원칙: "모든 부수효과는 worktree 내부". Legacy 가 위반하고 있었음.
- debug 와 vlm-config 은 사용자 전역 성격이므로 예외.

**구현 방법**: Adapter 에서 wrapping 할 때 path resolver 를 주입:

```typescript
// verify agent 의 path 결정 로직을 override
const pathResolver = {
  debug: () => joinHome('.autodev', 'debug'),
  baselines: () => join(ctx.worktreeRoot, '.autodev', 'baselines'),
  screenshots: () => join(ctx.worktreeRoot, '.autodev', 'screenshots'),
  pbt: () => join(ctx.worktreeRoot, '.autodev', 'pbt'),
  vlmConfig: () => joinHome('.autodev', 'vlm-config.json'),
};
```

**마이그레이션**: 기존 baselines 는 프로젝트별 한 번 복사 필요. Stage 3 에서는 자동 마이그레이션 스크립트 (`scripts/migrate-autodev-home.ts`) 제공, 1 회 실행 후 기존 디렉토리 삭제 가이드.

### 3.9 Input Transform — ADPL spec → Legacy input

```typescript
// src/lib/adpl/engine/adapters/agent/input-transform.ts

export function transformInput(
  spec: AgentNodeSpec,
  ctx: ExecutionContext
): LegacyAgentInput {
  return {
    role: spec.role,
    prompt: renderPrompt(spec.prompt, ctx.$),       // expression 평가
    systemPrompt: spec.systemPrompt ?? defaultSystemPromptFor(spec.role),
    context: {
      memoryBlock: spec.useMemory ? loadMemoryBlock(ctx.projectId) : undefined,
      planArtifact: spec.inputs?.plan ? ctx.$.resolve(spec.inputs.plan) : undefined,
      codeArtifact: spec.inputs?.code ? ctx.$.resolve(spec.inputs.code) : undefined,
      projectState: loadProjectState(ctx.projectId),
    },
    constraints: {
      timeout: spec.timeout ?? defaultTimeoutFor(spec.role),
      maxTokens: spec.maxTokens,
      tools: spec.tools,
    },
  };
}
```

### 3.10 Error Categorization

4B1 §6 (error categorization) 을 Stage 3 구현으로 번역:

| 에러 카테고리 | 감지 방법 | retry 대상 |
|-------------|----------|-----------|
| `network` | CLI stderr 에 fetch 실패 / socket timeout | ✅ (max 2) |
| `rate-limit` | HTTP 429, Gemini "quota exceeded" | ✅ (exponential, Retry-After) |
| `timeout` | ctx.abortSignal AbortError | ❌ (사용자 설정 문제) |
| `tool-denied` | "permission denied", allowlist 위반 | ❌ |
| `parse-error` | output JSON 파싱 실패 | ✅ (max 1, 프롬프트 강화) |
| `partial-fallback` | SDK → CLI 전환 중 부분 결과 손실 (보고서 10.2) | ❌ (이미 CLI 로 폴백 완료) |
| `prompt-truncated` | Codex 12K slicing 발생 (보고서 10.3) | ❌ (structural, 재시도해도 동일) |
| `cost-budget-exceeded` | node/run 의 maxBudgetUsd 초과 (보고서 10.6) | ❌ (사용자 한도 증액 필요) |
| `external-api-down` | VLM OpenRouter / Playwright MCP 연결 실패 (보고서 10.8) | ✅ (max 1, exponential) |
| `hallucination` | Verify 에서 구조적 이상 감지 (존재하지 않는 경로 등) | ❌ (report only, Stage 7) |
| `unknown` | 그 외 | ❌ |

카테고리는 `AdapterError` 의 `category` 필드로 전파되며, Worker 가 retry 결정에 사용.

### 3.11 Streaming 이벤트 정책

- `token` 이벤트는 **실제 LLM 토큰**만 (CLI 의 프로그레스 메시지 제외)
- `progress` 이벤트는 Phase 전환 (예: "tool call started", "editing file X") 시에만
- `log` 이벤트는 debug 용, 기본 필터링

Streaming UI (G4 Mermaid Plan view 같은) 는 `token` 과 `progress` 만 구독하면 된다.

### 3.12 Cancel 구현

```typescript
async cancel(runId: string) {
  const backend = this.activeBackends.get(runId);
  if (!backend) return;
  await backend.cancel(runId);
  // backend 내부에서 child.kill('SIGTERM') → 5초 후 SIGKILL
}
```

Stage 2 의 Executor 가 `ctx.abortSignal` 을 전달하므로 대부분의 backend 는 signal 만 듣고 있으면 됨. explicit cancel 은 외부 트리거 (UI 취소 버튼) 용.

### 3.13 수락 기준 (Stage 3 Week 7 종료 시)

- [ ] `AgentNodeSpec` (role=planner, model=autodev-internal) 실행 → artifact 반환
- [ ] role=coder, model=claude-code → diff 반환
- [ ] role=verifier, model=gemini-cli → score 반환 + debug dump 생성
- [ ] role × model 매트릭스 위반 시 ValidationError
- [ ] Streaming token 이벤트 UI 에서 수신 확인
### 3.13 수락 기준 — C7-1 (Week 7 Day 1-3)

**C7-1 범위는 Planner / Coder role + 4 backend**. Verifier 는 최소 동작만 (아래 별도).

- [ ] `AgentNodeSpec` (role=planner, model=autodev-internal) 실행 → artifact 반환
- [ ] `AgentNodeSpec` (role=planner, model=gemini-cli) → artifact 반환
- [ ] `AgentNodeSpec` (role=coder, model=claude-code) → diff 반환 (SDK 경로)
- [ ] `AgentNodeSpec` (role=coder, model=claude-code) → CLI 폴백 경로 동작 + `partial-fallback` 에러 정확히 발생
- [ ] `AgentNodeSpec` (role=coder, model=codex-cli) → 12K 초과 시 `prompt-truncated` progress 이벤트 발생
- [ ] role × model 매트릭스 위반 시 ValidationError
- [ ] Evaluator role 사용 시도 시 "reserved" ValidationError
- [ ] Streaming token 이벤트 UI 에서 수신 확인
- [ ] Cancel → child process SIGTERM 후 5 초 내 종료
- [ ] 전역 CLI 캐시 `clearCliCache()` 호출로 테스트 간 격리 확인
- [ ] Planner/Coder 단위 테스트 통과 (약 15 개)

### 3.14 수락 기준 — C7-1.5 (Verify Agent 최소 wrap, Week 7 Day 4-5 + Week 8 초)

**Verify Agent 는 1,641 줄 단일 파일 + 8 특수 모듈이라 전체 wrap 은 Stage 3 범위 초과 (10-15 시간).** C7-1.5 에서는 **최소 wrap** 만:

- [ ] `AgentNodeSpec` (role=verifier, model=auto-cross-model) 실행 → score 반환 (mechanical + evidence stages 만)
- [ ] `~/.autodev/debug/` dump 유지 확인
- [ ] baselines/screenshots/pbt 가 worktree 내부로 리디렉션되는지 확인 (마이그레이션 스크립트 동작)
- [ ] coder=claude-code → verifier 가 자동으로 codex-cli 또는 gemini-cli 선택 (selectDifferentFrom 동작)

**C7-1.5 에서 제외 (Stage 7 이월)**:
- VLM (Visual analysis, OpenRouter API) → 기존 코드가 async 호출하는 것만 wrap, 실패해도 score 계산은 진행
- PBT (Property-Based Testing) → 동일
- Visual Regression (baselines 비교) → 동일
- A11y / SAST → 동일
- Debate verification (Debate Mode와 연동된 검증) → Stage 4

즉 **"LLM + mechanical check 만 통과하는 Verify"** 를 Stage 3 종료 시점 상태로 삼는다. 나머지 8 개 특수 모듈은 기존 코드가 호출되지만 실패 시 warning 만.

---

## 4. Shell Adapter (C7-2 + C7-3)

> 4B4 §2 원본 스펙 참조
> Stage 3 범위: 완전 구현 (기존 hook 시스템 흡수 포함)

### 4.1 파일 구조

```
src/lib/adpl/engine/adapters/shell/
├── index.ts            # NodeAdapter 구현체
├── spawner.ts          # child_process.spawn 래퍼 (shell/exec 2 모드)
├── policy.ts           # allowlist/denylist 검증
├── output-parser.ts    # outputFormat 5 종 파싱
├── env-builder.ts      # Worktree env 자동 주입
├── stdin-injector.ts   # stdin 주입 로직
└── __tests__/
```

### 4.2 spawn 모드 2 종 (4B4 §2.3)

```typescript
// src/lib/adpl/engine/adapters/shell/spawner.ts

export function createSpawner(spec: ShellNodeSpec, ctx: ExecutionContext) {
  if (spec.shell !== false) {
    // shell: true (기본) — /bin/sh -c "cmd"
    return spawn('/bin/sh', ['-c', spec.command], {
      cwd: ctx.worktreeRoot,
      env: buildEnv(spec, ctx),
      signal: ctx.abortSignal,
    });
  } else {
    // shell: false — command + args 명시
    const [cmd, ...args] = spec.argv ?? spec.command.split(/\s+/);
    return spawn(cmd, args, {
      cwd: ctx.worktreeRoot,
      env: buildEnv(spec, ctx),
      signal: ctx.abortSignal,
    });
  }
}
```

**주의**: `shell: true` 기본값은 4B4 의 결정이지만, denylist 엄격도는 올려야 한다 (§4.4).

### 4.3 Output Format 5 종

```typescript
// src/lib/adpl/engine/adapters/shell/output-parser.ts

export function parseOutput(
  raw: Buffer,
  format: 'auto' | 'text' | 'json' | 'lines' | 'binary'
): unknown {
  switch (format) {
    case 'auto':
      return tryJsonElseText(raw);        // JSON 파싱 시도 → 실패 시 text
    case 'text':
      return raw.toString('utf-8').trim();
    case 'json':
      return JSON.parse(raw.toString('utf-8'));
    case 'lines':
      return raw.toString('utf-8').split(/\r?\n/).filter(Boolean);
    case 'binary':
      return { encoding: 'base64', data: raw.toString('base64'), size: raw.length };
  }
}

// 10MB 초과 시 truncate (4B4 §2 명시)
export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
```

### 4.4 정책 엔진 (allowlist / denylist)

Hook 시스템 흡수 (C7-3) 의 핵심. 기존 `toolPolicy` 를 재사용:

```typescript
// src/lib/adpl/engine/adapters/shell/policy.ts

import { loadProjectToolPolicy } from '@/lib/security/tool-policy';

export function checkCommand(command: string, projectId: string): PolicyResult {
  const policy = loadProjectToolPolicy(projectId);

  // Denylist 우선 — 매칭 시 즉시 거부
  for (const pattern of policy.deny ?? DEFAULT_DENY) {
    if (matchPattern(command, pattern)) {
      return { ok: false, reason: 'denylist', matched: pattern };
    }
  }

  // Allowlist 가 정의되어 있으면 엄격 모드
  if (policy.allow) {
    const matched = policy.allow.some(p => matchPattern(command, p));
    if (!matched) return { ok: false, reason: 'not-in-allowlist' };
  }

  return { ok: true };
}

const DEFAULT_DENY = [
  /rm\s+-rf\s+[\/~]/,
  /:(?:\(\)\s*\{\s*:\|:.)/,            // fork bomb
  /mkfs\./,
  /dd\s+if=.*of=\/dev\//,
  /curl\s+.*\|\s*(ba)?sh/,             // pipe to shell
  /wget\s+.*\|\s*(ba)?sh/,
];
```

**중요**: 정책 검증은 `execute` 시작 시점이 아니라 **`validate` 단계**에서 한다. 즉 YAML 파싱 직후, 실행 큐에 들어가기 전. 이유: pipeline 전체의 실행 가능성을 사전에 판정해야 사용자 경험이 좋음.

### 4.5 Stdin 주입 (4B4 §2.6)

```typescript
// src/lib/adpl/engine/adapters/shell/stdin-injector.ts

export async function injectStdin(child: ChildProcess, spec: ShellNodeSpec, ctx) {
  if (!spec.stdin) return;

  const content = typeof spec.stdin === 'string'
    ? spec.stdin
    : JSON.stringify(ctx.$.resolve(spec.stdin));

  // Codex CLI 학습에서 차용: 큰 payload 는 chunking
  if (content.length > 16 * 1024) {
    for (let i = 0; i < content.length; i += 4096) {
      child.stdin.write(content.slice(i, i + 4096));
      await new Promise(r => setImmediate(r));
    }
  } else {
    child.stdin.write(content);
  }
  child.stdin.end();
}
```

### 4.6 Worktree 환경변수 자동 주입

```typescript
// src/lib/adpl/engine/adapters/shell/env-builder.ts

export function buildEnv(spec: ShellNodeSpec, ctx: ExecutionContext) {
  return {
    ...process.env,                          // base
    ...ctx.env,                              // Executor 가 주입한 context env
    AUTODEV_RUN_ID: ctx.runId,
    AUTODEV_NODE_ID: ctx.nodeId,
    AUTODEV_PROJECT_ID: ctx.projectId,
    AUTODEV_WORKTREE: ctx.worktreeRoot,
    ...(spec.env ?? {}),                     // spec 에서 override (가장 마지막, 우선순위 높음)
  };
}
```

### 4.7 Hook 시스템 흡수 (C7-3)

기존 `PreX/PostX` hook 들은 **변환 없이 shell 노드로 매핑**. 변환 테이블:

| Legacy hook | ADPL 노드 |
|------------|----------|
| `preVerify: "pnpm lint"` | `{ id: pre-verify, type: shell, command: "pnpm lint" }` |
| `postCode: "pnpm format"` | `{ id: post-code, type: shell, command: "pnpm format", after: [code] }` |
| `preCommit: "pnpm verify:cross"` | `{ id: pre-commit, type: shell, command: "pnpm verify:cross", when: "$trigger.kind == 'commit'" }` |

Bridge 구현:

```typescript
// src/lib/adpl/legacy-bridge/hook-converter.ts

export function convertLegacyHooks(legacyConfig: LegacyPipelineConfig): ShellNodeSpec[] {
  const nodes: ShellNodeSpec[] = [];
  for (const [phase, command] of Object.entries(legacyConfig.hooks ?? {})) {
    nodes.push(hookToShellNode(phase, command));
  }
  return nodes;
}
```

**확인 포인트**: 기존 hook 이 의존하던 환경변수 (예: `AUTODEV_HOOK_PHASE`) 는 `env-builder` 에서 계속 제공해야 legacy 호환.

### 4.8 수락 기준

- [ ] `pnpm test --reporter=json` 실행 + JSON 파싱 성공
- [ ] Denylist 매칭 (`rm -rf /`) → validate 단계에서 저장 거부
- [ ] 10MB 초과 출력 → truncate + 메타정보 (truncated: true)
- [ ] stdin 주입 16KB 이상 → chunking 동작
- [ ] 기존 `post-verify` hook 이 shell 노드로 변환 후 동일 결과
- [ ] Worktree env 모두 child process 에 주입 확인

---

## 5. HTTP Adapter (C8-1)

> 4B4 §3 원본 스펙 참조

### 5.1 파일 구조

```
src/lib/adpl/engine/adapters/http/
├── index.ts
├── body-builder.ts       # 5 format (json/form/text/binary/multipart)
├── retry.ts              # method별 idempotent 기본값 + Retry-After
├── allowlist.ts
└── __tests__/
```

### 5.2 Body Format 5 종

```typescript
// src/lib/adpl/engine/adapters/http/body-builder.ts

export function buildBody(spec: HttpNodeSpec, ctx): { body: BodyInit; headers: Headers } {
  const fmt = spec.bodyFormat ?? 'json';
  const headers = new Headers(spec.headers ?? {});

  switch (fmt) {
    case 'json':
      headers.set('content-type', 'application/json');
      return { body: JSON.stringify(spec.body), headers };
    case 'form':
      headers.set('content-type', 'application/x-www-form-urlencoded');
      return { body: new URLSearchParams(spec.body as any).toString(), headers };
    case 'text':
      headers.set('content-type', 'text/plain');
      return { body: String(spec.body), headers };
    case 'binary':
      return { body: Buffer.from(spec.body as string, 'base64'), headers };
    case 'multipart':
      return buildMultipart(spec, headers);
  }
}
```

### 5.3 Retry — method 별 idempotent 기본값

4B4 §3.5 의 원칙: **GET/HEAD/PUT/DELETE 는 idempotent, POST 는 아님**.

```typescript
// src/lib/adpl/engine/adapters/http/retry.ts

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

export function defaultRetryMax(method: string, spec: HttpNodeSpec): number {
  // spec.retry.max 명시되면 그대로
  if (spec.retry?.max !== undefined) return spec.retry.max;

  // POST 는 0 (idempotencyKey 헤더 있으면 2 로 완화)
  if (method === 'POST') {
    return spec.headers?.['idempotency-key'] ? 2 : 0;
  }

  return IDEMPOTENT_METHODS.has(method) ? 2 : 0;
}
```

### 5.4 Retry-After 존중

429 / 503 응답 시 `Retry-After` 헤더를 읽어 대기:

```typescript
export function computeBackoff(
  attempt: number,
  response: Response | null,
  spec: HttpNodeSpec
): number {
  // 1순위: Retry-After 헤더
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;
    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now());
  }

  // 2순위: spec.retry.backoff
  const base = spec.retry?.backoff?.baseMs ?? 500;
  return base * Math.pow(2, attempt);
}
```

### 5.5 Allowlist (URL 허용 목록)

4B4 §3.7 — 프로젝트 레벨 allowedHosts 설정 존중.

```typescript
// src/lib/adpl/engine/adapters/http/allowlist.ts

export function checkHost(url: string, projectId: string): { ok: boolean; reason?: string } {
  const policy = loadProjectHttpPolicy(projectId);
  if (!policy.allowedHosts) return { ok: true };  // 정책 없으면 통과

  const parsed = new URL(url);
  for (const pattern of policy.allowedHosts) {
    if (matchHost(parsed.host, pattern)) return { ok: true };
  }
  return { ok: false, reason: `host '${parsed.host}' not in allowlist` };
}
```

### 5.6 수락 기준

- [ ] GitHub API GET `/repos/.../pulls/N` → JSON 파싱 성공
- [ ] POST + `idempotency-key` 헤더 → retry.max 2 자동 적용
- [ ] 429 + `Retry-After: 60` → 60 초 대기 후 재시도
- [ ] allowedHosts 미매칭 → validate 단계 거부
- [ ] 5 bodyFormat 모두 서버에 올바른 Content-Type 전송

---

## 6. Webhook Out Adapter (C8-2)

> 4B4 §4 — HTTP 위에 얇게 쌓는 레이어

### 6.1 파일 구조

```
src/lib/adpl/engine/adapters/webhook-out/
├── index.ts
├── providers/
│   ├── slack.ts
│   ├── discord.ts
│   ├── teams.ts
│   └── generic.ts
├── rate-limiter.ts
└── __tests__/
```

### 6.2 HTTP adapter 재사용 원칙

webhook_out 은 "어떤 provider 에 어떤 구조의 payload 를 보내는가" 를 알 뿐, 실제 네트워크 호출은 HTTP adapter 에 위임한다.

```typescript
// src/lib/adpl/engine/adapters/webhook-out/index.ts

import { httpAdapter } from '../http';

export const webhookOutAdapter: NodeAdapter<WebhookOutNodeSpec> = {
  type: 'webhook_out',

  async *execute(spec, ctx) {
    const provider = providers[spec.provider];
    const httpSpec = provider.buildHttpSpec(spec, ctx);

    // webhook_out 기본값: silentFail, failOnError=false
    const mergedSpec = {
      ...httpSpec,
      failOnError: spec.failOnError ?? false,
      silentFail: spec.silentFail ?? true,
    };

    // Rate limit 체크
    await rateLimiter.acquire(spec.provider, ctx.projectId);

    // HTTP adapter 위임
    yield* httpAdapter.execute(mergedSpec, ctx);
  },
};
```

### 6.3 Provider 템플릿 (4B4 §4.4)

```typescript
// src/lib/adpl/engine/adapters/webhook-out/providers/slack.ts

export const slackProvider = {
  buildHttpSpec(spec: WebhookOutNodeSpec, ctx): HttpNodeSpec {
    return {
      method: 'POST',
      url: spec.url,
      bodyFormat: 'json',
      body: {
        text: renderTemplate(spec.message, ctx.$),
        attachments: spec.attachments,
        // channel/username 등 Slack 특화 필드
      },
      timeout: spec.timeout ?? 10,
    };
  },
};
```

### 6.4 Rate Limiter

프로바이더별 + 프로젝트별 throttle. 메모리상 token bucket:

```typescript
// src/lib/adpl/engine/adapters/webhook-out/rate-limiter.ts

const LIMITS = {
  slack:   { rps: 1, burst: 5 },
  discord: { rps: 5, burst: 10 },
  teams:   { rps: 4, burst: 8 },
  generic: { rps: 10, burst: 20 },
};

class TokenBucket { /* ... */ }

export const rateLimiter = {
  async acquire(provider: string, projectId: string): Promise<void> {
    const key = `${provider}:${projectId}`;
    const bucket = getBucket(key, LIMITS[provider]);
    await bucket.acquire();
  },
};
```

### 6.5 when 조건부 발송

Stage 5 의 expression evaluator 완성 전에도 기본형 지원:

```typescript
if (spec.when !== undefined) {
  const condValue = ctx.$.resolve(spec.when);
  if (!condValue) {
    yield { type: 'completed', result: { ok: true, output: { skipped: true }, metrics: {} } };
    return;
  }
}
```

### 6.6 수락 기준

- [ ] Slack Incoming Webhook POST 성공 (실제 workspace)
- [ ] `when: false` → 네트워크 호출 없이 skipped 반환
- [ ] Rate limit 도달 → `acquire()` 대기
- [ ] Provider 4 종 모두 Content-Type/payload 형식 올바름

---

## 7. Facade 전략 (C9-1, C9-2)

### 7.1 Facade 의 역할

`src/lib/pipeline.ts` 는 현재 ~1400 줄의 legacy 모노리스. Stage 3 에서 **완전 재작성하지 않는다**. 대신 **상단에 분기 레이어**를 추가:

```typescript
// src/lib/pipeline.ts (Stage 3 후)

export async function runPipeline(task: Task): Promise<PipelineResult> {
  if (task.executionMode === 'phase-p') {
    const yaml = await loadPipelineYaml(task.projectId);
    return phaseP.runPipeline(yaml, task);   // 새 엔진
  }

  // 기존 로직 — 건드리지 않음
  return runLegacyPipeline(task);
}
```

### 7.2 executionMode 결정 로직

Stage 3 의 default 는 `'legacy'`. `'phase-p'` 로 전환 조건:

1. 프로젝트에 유효한 YAML 파이프라인이 저장되어 있음
2. `projects.execution_mode = 'phase-p'` 설정
3. (Shadow 모드일 경우) 실제 실행은 legacy, shadow 만 phase-p

UI 에서 "Phase P 로 전환" 토글을 두되, Stage 3 의 Exit 기준 (Shadow 80%+ 일치) 이 만족된 프로젝트에만 활성화 가능.

### 7.3 Legacy-equivalent YAML 자동 생성 (C9-2)

프로젝트 생성 시 자동으로 저장되는 기본 YAML:

```yaml
adplVersion: 1
name: default-dev-pipeline
triggers:
  - id: t
    type: task_created

pipeline:
  - id: plan
    type: agent
    role: planner
    model: gemini-cli
    useMemory: true

  - id: code
    type: agent
    role: coder
    model: claude-code
    inputs:
      plan: "$nodes.plan.output"

  - id: verify
    type: agent
    role: verifier
    model: gemini-cli
    inputs:
      code: "$nodes.code.output"
```

`src/lib/adpl/defaults/pipeline-generator.ts` 가 프로젝트 생성 시점에 호출되어 `pipeline_versions` 테이블에 insert.

### 7.4 pipeline.ts 의 운명 (R2.5 와의 관계)

메모리 기록의 "R2.5 Pipeline refactor — 현재 ~1400 줄" 은 Stage 3 의 공식 목표가 아니다. 단, Facade 도입이 사실상 첫 삽. Stage 3 종료 시:

```
pipeline.ts  (~1400 줄)
├── runPipeline() (새 — 80 줄, facade)
└── runLegacyPipeline() (기존 로직 — 약 1300 줄, 그대로)
```

**Stage 3 내에서는 `runLegacyPipeline` 내부를 리팩토링하지 않는다**. 이유: 리팩토링 중 버그가 Shadow 검증을 오염시킴. 리팩토링은 Shadow 모드가 안정되어 phase-p 가 primary 가 된 이후 (Stage 7+).

---

## 8. Shadow 모드 (C9-3, C9-4)

### 8.1 Shadow 의 목적

Phase P 엔진을 **운영 리스크 없이** 실전 검증. Legacy 가 primary (실제 결과), Phase P 가 shadow (검증만).

```
Task → Legacy Pipeline → 사용자 결과 반환 (normal path)
     └ Phase P Pipeline → Shadow 결과 저장 (fire-and-forget)
                                   ↓
                            Comparator → Report
```

### 8.2 Runner 구조

```typescript
// src/lib/adpl/shadow/runner.ts

export async function runWithShadow(task: Task): Promise<PipelineResult> {
  const primary = runLegacyPipeline(task);

  // Sampling
  if (shouldShadow(task)) {
    const shadow = runPhaseP(task).catch(err => ({ ok: false, error: err }));
    // Primary 완료 대기 없이 병렬 실행
    shadow.then(shadowResult => primary.then(primaryResult => {
      compareAndStore(primaryResult, shadowResult, task);
    }));
  }

  return primary;   // 사용자에게는 항상 legacy 결과
}

function shouldShadow(task: Task): boolean {
  const cfg = loadShadowConfig(task.projectId);
  if (!cfg.enabled) return false;
  return Math.random() < (cfg.samplingRate ?? 0.1);
}
```

### 8.3 Comparator — 3 단 비교

```typescript
// src/lib/adpl/shadow/comparator.ts

export interface ComparisonResult {
  structural: StructuralDiff;     // 노드 실행 순서, 실행 개수
  metric: MetricDiff;              // 토큰 비용, 소요 시간, score
  semantic: SemanticDiff;          // artifact 의미적 유사도 (embedding)
}
```

**Structural** 은 hard — 100% 일치 기대. 다르면 버그.
**Metric** 은 soft — v1 은 30% 이내 허용 (LLM variance).
**Semantic** 은 exploratory — 0.7 이상 similarity 목표, 미만은 인사이트 기록만.

### 8.4 Report 저장

```
~/.autodev/shadow-reports/
├── 2026-04-21T10-00-00Z_task_abc123.json
├── summary-weekly.md        # 집계 리포트 (주 1 회)
└── alerts/
    └── structural-mismatch_task_xyz789.json    # hard 실패만
```

### 8.5 Stage 3 Exit 기준 (최종)

로드맵 v7 §4.5 재확인 — 이 문서가 추가로 명시하는 것:

- [ ] Shadow 실행 10+ task (AutoDev 자체 개발 task 로)
- [ ] Structural 일치 100%
- [ ] Metric diff 중앙값 < 30%
- [ ] Semantic similarity 중앙값 > 0.7
- [ ] Legacy task 회귀 0건 (주요 지표: verify score 차이 < 5 점)
- [ ] `docs/phase-p/stage-3-shadow-report.md` 작성

---

## 9. 열린 질문 (Stage 3 진행 중 결정 보류 가능)

Stage 3 를 시작하기 전에 답할 필요 없지만, 중간에 마주칠 질문들. 미리 인지하고 있으면 결정 시 덜 막힘.

### 9.1 Agent adapter 질문

1. **Memory block 주입 시점**: `useMemory: true` 일 때 memory 를 `systemPrompt` 에 주입할지, 별도 `context.memory` 필드로 줄지? → **잠정**: 별도 필드 (기존 코드 호환).

2. **Token 이벤트 throttle**: LLM 스트리밍 토큰을 1:1 로 `AdapterEvent` 로 emit 하면 UI 가 버벅일 수 있음. Batch 해야 하나? → **잠정**: 50ms 또는 100 토큰 단위 batch.

3. **Debate Mode role 명명**: `drafter` / `challenger` / `quality-checker` 가 공식 role 인가? Stage 3 의 ROLE_MODEL_MATRIX 에 포함? → **잠정**: 포함. Layer 1 = Layer 2 symmetry 에 필요.

4. **기존 evaluator role 처리**: 메모리상 "evaluator 는 reserved 역할, UI disabled" — Stage 3 matrix 에서 제외하되, error message 에서 "reserved for future use" 명시.

### 9.2 Shell adapter 질문

5. **exit code 0 이외 처리**: 기본 `failOnError: true` 면 exit code ≠ 0 시 노드 실패. 하지만 `diff`, `grep` 등은 "결과 없음" 을 non-zero 로 반환. → **잠정**: `expectedExitCodes: [0, 1]` 필드 추가 (4B4 에 이미 있을 가능성, 재확인).

6. **stderr 별도 캡처**: `NodeOutput` 에 stdout/stderr 분리? 합쳐서? → **잠정**: 분리. `output.stdout`, `output.stderr`.

### 9.3 HTTP adapter 질문

7. **자체 서명 인증서**: 개발 환경의 self-signed cert 허용 플래그? → **잠정**: 프로젝트 정책으로 opt-in, 기본 거부.

8. **Proxy 지원**: 기업 환경의 HTTP proxy 환경변수 존중? → **잠정**: `HTTPS_PROXY` 등 표준 env 자동 존중.

### 9.4 Shadow 모드 질문

9. **Worktree 공유 여부**: Primary 와 shadow 가 같은 worktree 를 쓰면 race condition. 다른 worktree 면 git 조작 2 배. → **잠정**: shadow 는 read-only worktree clone (Stage 3 범위 내 구현 가능한지 재확인 필요).

10. **Shadow 실패 시 알람**: Structural mismatch 10 개 연속 → 자동 Shadow off? → **잠정**: Alert 만, 자동 off 안 함 (사람 판단).

### 9.5 Facade 질문

11. **실행 mode 전환 UI**: Legacy ↔ Phase P 토글을 어디에? 프로젝트 설정? task 별? → **잠정**: 프로젝트 레벨만 Stage 3 (task 별은 Stage 7+).

---

## 10. Stage 3 → Stage 4 핸드오프 체크리스트

Stage 4 (Flow Adapters — branch, parallel, loop, gate) 를 시작할 수 있는 조건.

### 10.1 기능적 체크리스트

- [ ] 4 leaf adapter 단위 테스트 모두 통과 (backend 별 포함 시 30+ 테스트)
- [ ] Registry 등록 및 Executor 연동 확인
- [ ] Legacy-equivalent YAML 로 실제 task 1 건 end-to-end 성공
- [ ] Shadow 모드 10+ task 실행 + report 생성
- [ ] Stage 3 Exit 기준 체크리스트 (로드맵 v7 §4.5) 모두 ✅

### 10.2 설계 문서 업데이트

- [ ] 이 문서 (설계 6) 의 "열린 질문" 중 Stage 3 진행 중 답이 나온 것 → **결정** 으로 승격
- [ ] `docs/phase-p/stage-3-retro.md` 작성 (Stage 4 스펙 조정 자료)
- [ ] 4B1/4B4 스펙과 Stage 3 구현 사이에 발견된 차이 → 4B1/4B4 업데이트 또는 스펙 변경 노트 추가

### 10.3 코드 정리

- [ ] adapter/ 디렉터리 구조가 Stage 4 의 flow adapter 를 수용할 수 있는지 확인
  ```
  src/lib/adpl/engine/adapters/
  ├── agent/
  ├── shell/
  ├── http/
  ├── webhook-out/
  ├── (Stage 4) branch/
  ├── (Stage 4) parallel/
  ├── (Stage 4) loop/
  └── (Stage 4) gate/
  ```
- [ ] Legacy bridge (hook-converter 등) 가 Stage 4 flow 노드 추가로 깨지지 않는 구조
- [ ] `AdapterEvent` 타입이 flow 노드의 fan-out/fan-in 이벤트도 수용 가능한지 재검토

### 10.4 리스크 이월 목록

Stage 3 에서 **발견했지만 해결하지 않은** 항목을 기록하여 Stage 4+ 에서 재점검:

- (예정) Verify Agent hallucination 재현 빈도 (debug dump 분석)
- (예정) Codex CLI stdin chunking 의 최적 chunk size
- (예정) Shadow metric diff 가 30% 근접하는 task 유형 패턴

---

## 11. 요약

### 11.1 Stage 3 의 본질

"Stage 2 가 만든 **빈 Executor 틀**에, 실제로 돌아가는 **Adapter 4 개**를 끼워 넣어서 legacy 파이프라인을 재현하는 것."

### 11.2 핵심 결정 5 가지 (재확인)

1. Leaf adapter = 4 개 (mcp 제외, v1.5+)
2. Agent adapter 추상화 = 얕게 (2-layer 심화는 Stage 7)
3. 기존 자산 = wrap, not port
4. Hook 시스템 = shell adapter 로 흡수
5. Facade + Shadow = 실전 리스크 없이 검증

### 11.3 다음 세션 시작점

```
Week 7 Day 1-3 — 작업 C7-1 (Planner + Coder wrap)
├── 1. 이 문서 §3.1 ~ §3.13 재독 (15 분)
├── 2. 보고서 docs/phase-p/stage-3-c7-1-investigation.md §2, §6 재독 (20 분)
├── 3. Claude Code 프롬프트 작성:
│      "adapters/agent/ 디렉토리 생성 + Planner 와 Coder role 에 해당하는
│       AutoDevAgentBackend + 3 개 CLI backend 를 §3.5~3.7 명세대로 구현.
│       Verifier role 은 C7-1.5 에서 처리하므로 이번엔 signature 만 선언.
│       전역 CLI 캐시 clearCliCache() 테스트 헬퍼 포함."
└── 결과 보고 후 → Day 4-5 는 C7-1.5 (Verify 최소 wrap)
```

Stage 3 Week 7 은 원래 "Agent + Shell 2 일씩" 이었으나, 조사 결과 agent 만으로 4-5 일 소요. Shell 은 Week 7 마지막 ~ Week 8 초로 이동. Week 8 HTTP + Webhook Out 은 원 계획 유지. Week 9 Facade + Shadow 도 유지.

---

**끝.**
