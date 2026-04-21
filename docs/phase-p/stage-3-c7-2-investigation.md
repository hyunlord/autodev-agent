# Stage 3 C7-2 사전 조사 — Shell Adapter 구현 대상 파악

> 작성: 2026-04-21  
> 목적: C7-2 (Shell adapter) + C7-3 (Hook Bridge) 구현 전 기존 자산·계약·리스크 파악  
> 방법: 코드 읽기 + grep 조회만 (수정 없음)

---

## 1장. 현재 Hook 시스템의 실체

### 1.1 위치 및 구조

```
src/lib/hooks/hook-engine.ts   ← HookEngine 클래스 (단일 파일, 543줄)
```

### 1.2 HookEvent 전체 목록 (21개)

```typescript
// 기존 12개
'TaskStart' | 'PrePlan' | 'PostPlan' | 'PlanReview'
| 'PreCode' | 'PostCode' | 'PreVerify' | 'PostVerify'
| 'OnRetry' | 'OnReplan' | 'TaskComplete' | 'TaskFail'

// K9 신규 9개
| 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd'
| 'AgentSwitch' | 'SubTaskStart' | 'SubTaskComplete'
| 'PreCompact' | 'OnEscalation'
```

### 1.3 HookDefinition 타입

```typescript
export interface HookDefinition {
  name: string;
  type: 'command' | 'script' | 'agent' | 'http';
  // command
  command?: string;
  // script
  path?: string;
  // agent
  prompt?: string;
  llm?: string;
  tools?: string[];
  // http
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  // common
  timeout?: number;      // seconds (default: 30)
  blocking?: boolean;    // default: true
  failAction?: 'ignore' | 'warn' | 'retry' | 'replan' | 'fail';
}
```

1 phase = **multiple hooks** 가능 (`HookMatcher.hooks: HookDefinition[]` 배열).

### 1.4 command 실행 시그니처

```typescript
// src/lib/hooks/hook-engine.ts L346-401 — runCommand()
private async runCommand(hook: HookDefinition, input: HookInput): Promise<HookOutput> {
  const ex = await getExeca();          // execa 래퍼
  let cmd = hook.command.replace(/\{\{(\w+)\}\}/g, ...);  // {{taskId}}, {{projectDir}}
  const result = await ex(cmd, {
    shell: true,
    cwd: input.projectDir,
    reject: false,
    timeout: (hook.timeout ?? 30) * 1000,
    stdin: 'pipe',
    input: JSON.stringify(input),       // hook input 전체를 stdin으로 전달
  });
  // exit 2 → deny, JSON stdout → structured, plain text → additionalContext
}
```

- **환경변수**: `process.env` 기본 상속. `AUTODEV_XXX` 자동 주입 없음 (template vars만)
- **output 처리**: emit log, finalDecision으로 파이프라인 제어, `additionalContext`를 다음 에이전트 프롬프트에 주입
- **에러 처리**: `failAction = 'fail'` 이면 deny, 나머지는 allow

### 1.5 호출 지점

| 파일 | 이벤트 | 줄 |
|------|--------|-----|
| `pipeline-verify.ts` | PreVerify | L90 |
| `pipeline-verify.ts` | PostVerify | L261 |
| `pipeline-coding.ts` | PreCode | L363 |
| `pipeline-coding.ts` | PostCode | L524 |
| `pipeline-coding.ts` | OnRetry | L282 |
| `pipeline-coding.ts` | TaskComplete | L618 |

### 1.6 설정 파일 로딩 우선순위

```
1. 코드 내장 default (loadDefaults)
2. ~/.autodev/hooks.json  (global)
3. {projectDir}/.autodev/hooks.json  (project)
```

---

## 2장. toolPolicy 시스템 현황

### 2.1 타입 정의

```typescript
// src/lib/adpl/types/nodes/agent.ts L19
export type ToolPolicySpec = Record<string, unknown>;
```

**사실상 미구현 stub**. 의미있는 구조 없음.

`AgentNodeSpec`에는 `toolPolicy?: ToolPolicySpec` 필드가 있지만, `ShellNodeSpec`에는 없다.

### 2.2 `loadProjectToolPolicy()` 함수 존재 여부

**없음.** 설계 §4.4의 `loadProjectToolPolicy(projectId)` 호출은 가상 코드였음.

### 2.3 기존 대체재 — command-checker.ts

```typescript
// src/lib/safety/command-checker.ts L1-59
const DESTRUCTIVE_PATTERNS = [
  /rm\s+(-rf|-r)\s+\//,        // rm -rf /
  /git\s+push\s+.*--force/,    // git push --force
  /chmod\s+777/,
  /mkfs\./,
  /curl.*\|\s*sh/,             // curl | sh
  /sudo\s+/,
  // ... 17개 패턴
];

const WORKSPACE_ESCAPE_PATTERNS = [
  /cd\s+\.\.\//,               // cd ../
  /cat\s+\/etc\//,
  /cat\s+~\//,
];

export function checkCommand(command: string): CommandCheckResult {
  // → { safe: boolean, warnings: string[] }
}
```

- project별 정책: **없음** (코드 내장 regex만)
- DB/파일 저장: **없음**
- ADPL hook-engine과 연동: **없음** (별도 경로)

### 2.4 현재 어디서 호출하는가

`command-checker.ts`는 현재 planning agent 내부에서 tool call 검사용으로만 쓰인다. Shell adapter용 policy 체크는 신규 구현 필요.

---

## 3장. child_process.spawn 기존 사용 패턴

### 3.1 ClaudeCodeAgent (execa 기반)

```typescript
// src/lib/plugins/agents/claude-code.ts L208-215
const childProcess = execa(cliPath, args, {
  cwd: opts.projectDir,
  timeout: opts.timeoutMs ?? 300_000,
  reject: false,
  env: { ...process.env },
});
// stdout: event listener ('data') → line 단위 JSON 파싱
```

### 3.2 verify-agent.ts runCliWithTimeout (raw spawn)

```typescript
// src/agents/verify/verify-agent.ts L914-934
const { spawn } = require('child_process');
const child = spawn(cmd, args, {
  cwd: opts.cwd,
  detached: true,           // process group 생성 (자식 프로세스 트리 킬 목적)
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
});
// timeout: setTimeout → process.kill(-child.pid!, 'SIGKILL')
// close 이벤트: clearTimeout → resolve
```

**이유**: execa v9의 timeout이 CLI 자식 프로세스 트리를 신뢰할 수 없게 종료함. 대안으로 raw spawn + detached + negative PID kill 패턴 사용.

### 3.3 hook-engine.ts runCommand (execa)

```typescript
const result = await ex(cmd, {
  shell: true,
  cwd: input.projectDir,
  reject: false,
  timeout: (hook.timeout ?? 30) * 1000,
  input: JSON.stringify(input),   // stdin에 hook input 전달
});
```

### 3.4 공통 패턴 요약

| 항목 | ClaudeCodeAgent | verify-agent | hook-engine |
|------|----------------|--------------|-------------|
| 실행 방법 | execa | raw spawn | execa |
| shell 모드 | false | false | true |
| cwd | projectDir | projectDir | projectDir |
| timeout | execa timeout | setTimeout+SIGKILL | execa timeout |
| stdin | 없음 | ignore | JSON(input) |
| AbortSignal | 없음 | 없음 | 없음 |

**AbortSignal**: 파이프라인 레벨 `checkAbort()` 패턴만 사용. 각 backend는 직접 AbortSignal 연결 없음.

### 3.5 SIGTERM/SIGKILL 타임아웃

- execa: 자체 timeout (프로세스 그룹 kill 불안정)
- raw spawn: SIGKILL 즉시 (SIGTERM 없음, verify-agent 패턴)
- **Shell adapter 권고**: raw spawn + SIGTERM(5초) → SIGKILL 패턴 (verify-agent 개선판)

### 3.6 10MB 출력 제한

기존 어디에도 없음. 신규 구현 필요.

### 3.7 공통 유틸 추출 가능성

세 곳 모두 `cwd: worktreeRoot`+`env: {...process.env}` 패턴 반복. Shell adapter에서 `spawner.ts` 공통 유틸로 추출 시 재사용 가능.

---

## 4장. pipeline.ts에서 shell을 사용하는 지점

### 4.1 git 명령 사용 현황 (src/ 전체)

총 5건:

| 파일 | 내용 | 처리 |
|------|------|------|
| `pipeline.ts:386` | `git commit` | try/catch 무시 |
| `pipeline.ts:1017` | `git commit` | try/catch 무시 |
| `verify-agent.ts:994` | `git diff` (Layer 1 코드 리뷰용) | 로직 내부 |
| `command-checker.ts:5` | `git push --force` denylist | 정적 체크 |
| `pipeline-diff-gate.ts:33` | J4 Diff Gate (git diff 기반) | 게이트 로직 |

직접 shell 호출은 최소화되어 있음. git 조작 대부분이 Node API (`git-utils.ts`, `getModifiedFiles()`)로 처리.

### 4.2 runMechanicalChecks의 shell 사용

`verify-agent.ts` L334-408:
- `npm install`: execa, `reject: false`, timeout 120s
- `npm run build`: execa, `reject: false`, timeout 60s
- 파일 존재 체크: Node.js `existsSync` — shell 없음

### 4.3 pnpm verify:cross / test / lint 직접 호출

**없음**. 이 명령들은 현재 hook (`PostCode`, `PreVerify` 등) 또는 `pnpm ship` 스크립트에서만 실행됨. Shell adapter가 완성되면 YAML 노드로 선언 가능해짐.

---

## 5장. 설계 §4.2~4.7 vs 실현 상 잠재적 충돌

### 5.1 NodeAdapter.validate() 시그니처 — YES 존재

```typescript
// src/lib/adpl/engine/adapters/types.ts L66-71
export interface NodeAdapter<Spec extends NodeSpec = NodeSpec> {
  readonly type: string;
  defaultTimeout(): number;
  validate(spec: Spec): ValidationResult;                        // ← 존재
  execute(spec: Spec, ctx: ExecutionContext, options: ExecutionOptions): Promise<NodeOutput>;
}
```

agent adapter 구현 패턴 (`adapters/agent/index.ts` L19-28):

```typescript
validate(spec: AgentNodeSpec): ValidationResult {
  try {
    resolveBackend(spec.role, spec.model);
    return { valid: true };
  } catch (err) {
    if (err instanceof AgentValidationError) {
      return { valid: false, errors: [{ message: err.message }] };
    }
    throw err;
  }
},
```

Shell adapter도 동일 패턴 적용 가능. policy 검증은 `validate()` 내부에서 수행.

### 5.2 ShellNodeSpec 필드명 불일치 (설계 vs 실제)

| 항목 | 설계 §4.2 | 실제 ShellNodeSpec |
|------|-----------|-------------------|
| shell 모드 | `shell: boolean` (true/false) | `mode: 'shell' \| 'exec'` (enum) |
| exec args | `argv?: string[]` | `args?: string[]` |
| exit code | `failOnError: boolean` | `failOnNonZero?: boolean` |
| 추가 exit codes | (§9.2 잠정) | `allowExitCodes?: number[]` ← **이미 반영됨** |
| stdout/stderr | (§9.2 분리 잠정) | 미정의 |

**구현 시 ShellNodeSpec 실제 타입 기준으로 작성**. 설계 pseudo-code의 `shell`/`argv`/`failOnError` 필드명은 사용 금지.

### 5.3 outputFormat

ShellNodeSpec에 5종 모두 정의됨 (`auto | text | json | lines | binary`). 기존 파싱 유틸 없음 → `output-parser.ts` 신규 구현. 충돌 없음.

### 5.4 stdin chunking — 공통 유틸 미확인

설계 §4.5에서 "Codex 패턴 차용" 언급. 실제 C7-1 Codex ADPL adapter에는 chunking 없음 (emitInputDegraded 후 legacy agent 위임). 

hook-engine의 `stdin: 'pipe', input: JSON.stringify(input)` 패턴이 가장 가까움. Shell adapter는 독립 구현 필요.

---

## 6장. Hook Bridge 구현 단위 분석

### 6.1 LegacyHookConfig 타입

없음. HookEngine은 이미 `HookMatcher[]` 구조를 사용하며 별도 "legacy" 인터페이스 없음.

### 6.2 1 phase = 여러 commands 가능

```typescript
// hook-engine.ts: HookMatcher.hooks는 HookDefinition[]
PostCode: [{
  matcher: '',
  hooks: [
    { name: 'file-check', type: 'command', command: "ls ...", blocking: false },
    { name: 'postcode-build', type: 'command', command: "npm run build", blocking: true },
  ],
}],
```

### 6.3 Hook 실행 순서

```
TaskStart → PrePlan → [plan] → PostPlan → PlanReview
→ PreCode → [coding] → PostCode → PreVerify
→ [verify] → PostVerify → TaskComplete / TaskFail
+ OnRetry / OnReplan (조건부)
+ K9: PreToolUse, PostToolUse, SessionStart, SessionEnd, AgentSwitch, ...
```

### 6.4 Hook 실패 시 bounce

| failAction | 결과 |
|-----------|------|
| `'fail'` | `decision: 'deny'` → pipeline abort |
| `'warn'` | emit warning log, allow |
| `'ignore'` | silent, allow |
| `'retry'` / `'replan'` | 현재 hook-engine 자체 처리 없음 — 상위 pipeline 제어 필요 |

### 6.5 C7-2 완료 후 YAML 표현 예시

```yaml
# PostCode hook → shell 노드
- id: post-code-build
  type: shell
  command: "npm run build 2>&1 | tail -5"
  after: [code]
  failOnNonZero: true

# PreVerify hook → shell 노드
- id: pre-verify-lint
  type: shell
  command: "pnpm lint"
  after: [code]
  allowExitCodes: [0]

# PreCommit hook (when 조건은 Stage 5 expression evaluator 필요)
- id: pre-commit-check
  type: shell
  command: "pnpm verify:cross"
  after: [verify]
```

### 6.6 C7-3 변환 대상

command/script type hook만 Shell 노드로 1:1 매핑 가능. **agent type → Stage 4 후 agent 노드**, **http type → HTTP adapter**. C7-3 범위 = command + script hook 변환만.

---

## 7장. Stage 2 NodeAdapter 계약 재확인

### 7.1 NodeAdapter<ShellNodeSpec> 구현 가능 여부

**YES**. `NodeAdapter<Spec extends NodeSpec>` generic 인터페이스에 ShellNodeSpec 적용 가능.

### 7.2 ShellNodeSpec 존재 여부

**YES**. 이미 정의됨:

```typescript
// src/lib/adpl/types/nodes/shell.ts
export interface ShellNodeSpec extends NodeSpecBase {
  type: 'shell';
  command: string;
  args?: string[];
  mode?: ShellMode;          // 'shell' | 'exec'
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  outputFormat?: ShellOutputFormat;
  failOnNonZero?: boolean;
  allowExitCodes?: number[];
  idempotencyKey?: string;
}
```

### 7.3 ShellNodeSpecSchema (Zod) 존재 여부

**YES**. 이미 정의됨:

```typescript
// src/lib/adpl/schemas/nodes/shell.ts
export const ShellNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('shell'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  mode: ShellModeSchema.optional(),
  // ...
  allowExitCodes: z.array(z.number().int()).optional(),
  idempotencyKey: z.string().optional(),
});
```

### 7.4 execute / validate 계약

```typescript
// types.ts L66-71 — 유효한 계약
validate(spec: ShellNodeSpec): ValidationResult;
execute(spec: ShellNodeSpec, ctx: ExecutionContext, options: ExecutionOptions): Promise<NodeOutput>;
```

`options.eventBus.emit()` 패턴 그대로 사용 가능.

### 7.5 AdapterRegistry 등록 방식

```typescript
// src/lib/adpl/engine/adapters/registry.ts
registry.register(shellAdapter);  // adapter.type = 'shell'
```

agent adapter와 완전히 동일. 순서 의존성 없음.

---

## 8장. Event 타입 신규 필요성

### 8.1 현재 EngineEvent에 shell 관련 없음

`run.*`, `node.*`, `flow.*`, `agent.*` 카테고리만 존재. shell 전용 없음.

### 8.2 신규 이벤트 필요성 분석

| 이벤트 | 필요성 | 근거 |
|--------|--------|------|
| `node.started` / `node.completed` | 이미 있음 | Engine 레벨에서 emit |
| `shell.output` | **필요** | pnpm build 같은 장시간 명령의 stdout streaming UI |
| `shell.exit` | 선택사항 | node.completed로 충분 |

### 8.3 권고 신규 이벤트

```typescript
export interface ShellOutputEvent extends EventBase {
  type: 'shell.output';
  nodeId: string;
  line: string;
  stream: 'stdout' | 'stderr';
}
```

EngineEvent union에 추가. `shell.output`만으로 UI 스트리밍 + 로그 기록 가능.

---

## 9장. 테스트 전략

### 9.1 기존 spawn mock 사례

agent tests (`__tests__/claude-code.test.ts` 등)는 `vi.mock`으로 상위 Agent 클래스 자체를 모킹. `child_process.spawn` 직접 모킹 패턴 없음.

### 9.2 Shell adapter 테스트 전략

| 영역 | 방법 | 예상 수 |
|------|------|--------|
| policy 검증 | 순수 로직 (`checkCommand` 입력/출력) | 8개 |
| outputFormat 파싱 | 순수 로직 | 5개 |
| stdin 주입 | mock spawn or 실제 `cat` | 3개 |
| env builder | 순수 로직 | 3개 |
| spawn mode (shell/exec) | 실제 `echo`/`node -e` | 4개 |
| 10MB truncate | mock or 실제 `dd` | 2개 |
| integration (E2E scenario) | 실제 명령 실행 | 3개 |
| **합계** | | **약 28개** |

### 9.3 cross-platform 안전 명령

```bash
echo hello            # OS 무관
node -e "console.log('ok')"   # Node.js 환경 보장
cat /dev/stdin         # stdin 테스트 (Linux/macOS)
```

### 9.4 Stage 2 E2E scenario 추가

C7-1 때 scenario 9 (`VERIFY`) 기반으로 scenario 10 (`SHELL_EXEC`) 추가:
```
shell 노드 → outputFormat: json → output 검증
```

---

## 10장. 예상 소요 시간 & 범위 재조정

### 10.1 컴포넌트별 추정

| 컴포넌트 | 내용 | 추정 시간 |
|---------|------|----------|
| Shell adapter core | spawner.ts + outputFormat 5종 + stdin | 3h |
| Policy 시스템 | command-checker.ts 재사용 + validate() 통합 + project-level 구조 | 1.5h |
| Env builder | worktreeRoot + AUTODEV_XXX 주입 | 0.5h |
| shell.output 이벤트 | types.ts 확장 + streaming emit | 0.5h |
| Hook Bridge (C7-3) | hook-converter.ts (command/script → ShellNodeSpec) | 1.5h |
| 테스트 | 28개 예상 | 1.5h |
| **합계** | | **8.5h ± 1.5h** |

### 10.2 C7-1 (6h) 대비 비교

| 항목 | C7-1 | C7-2 |
|------|------|------|
| 기존 자산 wrap 여부 | 대부분 wrap | 일부 wrap (command-checker), 일부 신규 |
| 타입 준비도 | AgentNodeSpec 기존 | ShellNodeSpec 이미 정의됨 ✅ |
| 주요 신규 구현 | streaming 이벤트 | spawn + outputFormat + policy |
| 테스트 복잡도 | mock agent | spawn mock or 실제 명령 |

Shell adapter는 기존 자산보다 신규 구현 비중이 높아 +2.5h 추가 예상.

---

## 발견사항 / 리스크 목록

| # | 발견사항 | 영향 | 대응 |
|---|---------|------|------|
| F1 | **ShellNodeSpec 필드명 불일치**: 설계 `shell: boolean` / `argv` / `failOnError` vs 실제 `mode: enum` / `args` / `failOnNonZero` | 구현 시 타입 에러 | **실제 타입 기준 구현** |
| F2 | **toolPolicy 미구현**: `ToolPolicySpec = Record<string, unknown>` stub | Shell policy 신규 구현 필요 | command-checker.ts 재사용 + allowPatterns/denyPatterns 신규 필드 |
| F3 | **stdin chunking 공통 유틸 없음**: C7-1 Codex adapter에 구현 없음 | Shell adapter stdin 처리 독립 구현 | hook-engine 패턴 참고하여 신규 작성 |
| F4 | **10MB output limit 없음**: 기존 어디에도 구현 없음 | 대용량 출력 시 메모리 위험 | Shell adapter `output-parser.ts`에서 신규 구현 |
| F5 | **K9 신규 9개 hook → Shell 변환 복잡성**: PreToolUse 등은 단순 command가 아님 | C7-3 scope 불명확 | command/script type만 변환, agent/http는 제외 |
| F6 | **execa timeout의 process tree kill 불안정**: verify-agent 팀이 이미 경험 | 장시간 shell 명령 종료 실패 가능 | raw spawn + process group kill 패턴 채택 |
| F7 | **AbortSignal 미연결**: 기존 backends 모두 미사용 | 파이프라인 cancel 시 shell 프로세스 잔류 | CancellationToken → `controller.abort()` → SIGTERM 연결 |

### 구현 전 결정이 필요한 사항

1. **policy 구조**: project-level policy를 DB에 저장할지, `.autodev/shell-policy.json` 파일로 할지 → 잠정: 파일 기반 (hook-engine 패턴 차용)
2. **stdout/stderr 분리**: `NodeOutput.data.stdout` / `NodeOutput.data.stderr` 분리 vs 합쳐서 `data.output` → 잠정: 분리 (§9.2 결정 반영)
3. **shell.output 이벤트**: EngineEvent union 추가 위치 → `events/types.ts` 수정 필요, C7-2 범위 내 포함

---

**끝.**
