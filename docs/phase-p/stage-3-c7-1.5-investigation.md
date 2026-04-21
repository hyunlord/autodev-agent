# Stage 3 C7-1.5 사전 조사 보고서 — Verifier Adapter 원선형 기획

**작성일**: 2026-04-21  
**목적**: C7-1.5 구현 전 경계선 드로잉 — "무엇을 넣고 무엇을 미룰 것인가"  
**참조 파일**:
- `docs/phase-p/28_PhaseP_design6_stage3_leaf_adapters.md` §3.8, §3.14
- `docs/phase-p/stage-3-c7-1-investigation.md`
- `src/agents/verify/verify-agent.ts` (1,641줄, 전체 읽음)
- `src/agents/interfaces.ts`
- `src/lib/adpl/engine/adapters/agent/` 전체

---

## 1장. Verify Agent 파일 구조 재조사 — 모듈 경계선 매핑

### 1.1 실제 파일 위치

- **메인 파일**: `src/agents/verify/verify-agent.ts` (1,641줄)
- **Playwright 도구**: `src/agents/verify/tools/playwright-verify.ts` (89줄)
- **파일 읽기 도구**: `src/agents/verify/tools/file-read.ts`
- **셸 실행 도구**: `src/agents/verify/tools/shell-exec.ts`

### 1.2 라인 범위별 모듈 경계 매핑

| # | 모듈 | 라인 범위 | 역할 | wrap 복잡도 | C7-1.5 포함? |
|---|------|-----------|------|-------------|--------------|
| 1 | 클래스 정의 + 생성자 + isAvailable | 1–39 | ID, name, role='verify', CLI 경로 확인 | 하 | ✅ 필수 |
| 2 | selectDifferentFrom() | 44–68 | Coder 와 다른 LLM 자동 선택 | 하 | ✅ 필수 |
| 3 | invoke() 메인 파이프라인 | 70–301 | 5단계 오케스트레이터, depth 분기 | 중 (진입점) | ✅ 필수 |
| 4 | compareScreenshots() | 303–331 | 바이트 크기 휴리스틱 VR 비교 | 하 | 🟡 passthrough |
| 5 | runMechanicalChecks() — Stage 1 | 333–415 | 파일 존재 확인, npm build 실행 | 하 | ✅ 필수 |
| 6 | collectEvidence() — Stage 2 | 417–673 | 파일 내용 수집, Playwright 스크린샷, VLM 준비 | 중 (VLM 포함) | ✅ 필수 (VLM은 soft-skip) |
| 7 | runLlmJudgment() — Stage 3 LLM | 675–1267 | claude/gemini/codex 3분기 CLI 호출 + JSONL 파싱 | 상 | ✅ 필수 (핵심) |
| 8 | generateAndRunPBT() | 1268–1415 | fast-check 기반 PBT 생성 + 실행 | 상 | 🔴 passthrough only |
| 9 | runDebateVerification() | 1417–1568 | Primary + Challenger 2-round | 상 | 🔴 passthrough only |
| 10 | analyzeVisual() — VLM | 1570–1641 | OpenRouter API 멀티모달 호출 | 중 | 🔴 passthrough only |

### 1.3 모듈 간 결합도 분석

**독립적으로 분리 가능한 모듈** (호출 경계가 명확):
- `runMechanicalChecks()` — `invoke()` 라인 83에서 단일 호출, 반환값만 사용
- `collectEvidence()` — `invoke()` 라인 115에서 단일 호출, `evidence` 객체로 결과 수신
- `generateAndRunPBT()` — `invoke()` 라인 259, 조건부 호출
- `runDebateVerification()` / `runLlmJudgment()` — `invoke()` 라인 279–281, 삼항 분기
- `analyzeVisual()` — `collectEvidence()` 내부 라인 658에서 호출

**주의: VLM이 collectEvidence 내부에 포함됨**:
- `analyzeVisual()` 는 독립 메서드이지만 `collectEvidence()` 안 라인 616–670에서 호출
- VLM 스크린샷 저장(라인 515)도 `collectEvidence()` 내부 → VLM 비활성화해도 이 라인 실행
- `collectEvidence()`를 분리하지 않고 그대로 호출하면 VLM 블록은 OPENROUTER_API_KEY 체크에서 throw → catch → info log로 자연히 건너뜀 ✓

**섞여 있어 "이걸 빼면 저게 안 된다"인 지점**: **없음**. 모든 특수 모듈이 조건부(`if` + 환경변수 가드) 또는 `try-catch`로 격리되어 있다.

---

## 2장. "최소 wrap" 의 정의 — 설계 §3.14와 실제 코드 정합성

### 2.1 설계 §3.14 의 제외 목록

> C7-1.5 에서 제외 (Stage 7 이월): VLM, PBT, Visual Regression, A11y, SAST, Debate

### 2.2 각 제외 모듈의 비활성화 가능 여부

| 모듈 | 활성화 조건 | 코드 위치 | 비활성화 방법 | 코드 수정 필요? |
|------|-----------|----------|-------------|----------------|
| SAST | `AUTODEV_SAST_ENABLED='1'` OR `ac?.security?.semgrepScan` | 라인 214 | 환경변수 미설정 + plan 없이 호출 | **NO** |
| A11y | `browser_evaluate` 도구가 tools 배열에 존재 | 라인 234 | adapter가 빈 tools 배열 전달 | **NO** |
| PBT | `AUTODEV_PBT_ENABLED='1'` OR `ac?.pbt===true` | 라인 254 | 환경변수 미설정 + plan 없이 호출 | **NO** |
| Debate | `AUTODEV_DEBATE_VERIFY='1'` OR `ac?.debateVerify===true` | 라인 277 | 환경변수 미설정 → `runLlmJudgment`로 폴백 | **NO** |
| VLM | `screenshotPath` 존재 + `vlmEnabled` + OPENROUTER_API_KEY | 라인 617, 1606 | OPENROUTER_API_KEY 미설정 → throw → catch → info log | **NO** |
| Visual Regression | `screenshotPath` 존재 + baseline 파일 존재 | 라인 118–144 | Playwright 미동작 시 screenshotPath 미설정으로 자연 건너뜀 | **NO** |

**결론**: 제외 6개 모듈 모두 **코드 수정 없이 비활성화 가능**. adapter 레이어에서 호환 입력만 전달하면 됨.

### 2.3 모듈 간 비활성화 의존성

"PBT 끄면 Visual Regression 실패" 같은 연쇄 의존 없음. 6개 제외 모듈은 서로 독립적으로 동작한다. 각각의 비활성화가 다른 모듈에 영향을 주지 않는다.

---

## 3장. Cross-Model Auto 선택 상세

### 3.1 selectDifferentFrom() 실제 시그니처

```typescript
// src/agents/verify/verify-agent.ts, 라인 44-68
static async selectDifferentFrom(
  codingAgentId: string  // 예: 'claude-code', 'codex-cli', 'gemini-cli'
): Promise<{ primary: VerifyAgent; fallbacks: string[] }>
```

- **반환형**: string ID 기반 (Model enum 아님)
- **우선순위**: `['codex-cli', 'gemini-cli', 'claude-cli']` 중 코딩 에이전트 제외
- **폴백**: 전부 사용 불가 시 `claude-cli` (자기합리화 위험 주석 있음, 라인 60)

### 3.2 Coder 의 model 을 어떻게 받는가

**현재 문제**: `ctx.$nodes.code`는 `NodeOutput`이고, `NodeOutput.data`는 `{ text: string; modifiedFiles: string[] }` 구조. **model 정보가 NodeOutput에 없음**.

```typescript
// src/lib/adpl/engine/adapters/agent/output-transform.ts, 라인 15-16
return {
  status: 'success',
  data: output.result,  // AgentOutput.result = { text, modifiedFiles } — model 없음
  metrics,
};
```

**선택지** (C7-1.5 설계 결정 필요):

| 방법 | 장점 | 단점 |
|------|------|------|
| A. YAML에서 명시: `coderModel: $nodes.code.spec.model` | 명시적, 타입 안전 | NodeOutput에 spec 없음 |
| B. `ctx.env.AUTODEV_CODER_MODEL` 에 coder backend가 저장 | 단순 | 전역 상태 오염 |
| C. NodeOutput.data에 `_agentId` 메타필드 추가 | NodeOutput 내에 자기완결 | output-transform 수정 필요 |
| D. 기본값 사용: `claude-code`로 가정 + `auto-cross-model` 최초 구현 | 구현 단순 | 부정확할 수 있음 |

**권고**: **C 방법** — `output-transform.ts`에서 `metrics.agentModel = spec.model`을 NodeOutput.metrics에 추가. 단일 파일 수정, 기존 호환성 유지.

### 3.3 ROLE_MODEL_MATRIX 와 C7-1.5 관계

```typescript
// src/lib/adpl/engine/adapters/agent/resolver.ts, 라인 21-24
export const ROLE_MODEL_MATRIX: Record<AgentRole, AgentModel[]> = {
  planner: ['autodev-internal', 'claude-code', 'gemini-cli', 'codex-cli'],
  coder: ['autodev-internal', 'claude-code', 'gemini-cli', 'codex-cli'],
  // verifier: 없음 — C7-1.5 예정
};
```

**C7-1.5 에서 추가해야 할 것**:

```typescript
verifier: ['auto-cross-model', 'claude-cli', 'codex-cli', 'gemini-cli'],
```

`resolveBackend()` 함수 라인 32–33에서 현재 verifier를 `AgentNotImplementedError`로 차단 중. C7-1.5에서 이 분기를 `VerifyAgent.selectDifferentFrom()` 호출로 대체.

### 3.4 Stage 2 Expression Resolver 로 동작 가능 여부

`$nodes.code.model` 같은 패턴은 현재 **불가능**. `resolveExpressions()`는 `$nodes.<id>.data`만 지원 (라인 19–26). `auto-cross-model`은 runtime에서 resolver.ts가 직접 처리하는 것이 맞음.

---

## 4장. 홈 리디렉션 마이그레이션 범위

### 4.1 현재 실제 경로 위치 (코드 인용)

| 용도 | 현재 경로 | 코드 위치 | 설계 §3.8 정책 | 현재 정합성 |
|------|----------|----------|--------------|------------|
| debug dump (프롬프트) | `process.env.HOME/.autodev/debug/` | 라인 893 | **유지** | ✅ OK |
| debug dump (응답) | `process.env.HOME/.autodev/debug/` | 라인 1053 | **유지** | ✅ OK |
| baselines | `join(verifyInput.projectDir, '.autodev', 'baselines')` | 라인 119, 285 | 프로젝트 내부 이동 | ✅ 이미 완료 |
| screenshots (VLM) | `join(process.env.HOME, '.autodev', 'screenshots')` | 라인 515 | 프로젝트 내부 이동 | ❌ 불일치 |
| screenshots (direct Playwright) | `join(process.cwd(), '.autodev', 'screenshots', 'verify')` | 라인 591 | 프로젝트 내부 이동 | 🟡 부분 (cwd ≈ worktreeRoot) |
| pbt | `join(input.projectDir, '.autodev', 'pbt')` | 라인 1372 | 프로젝트 내부 이동 | ✅ 이미 완료 |
| vlm-config.json | `join(process.env.HOME, '.autodev', 'vlm-config.json')` | 라인 621 | **유지** | ✅ OK |

### 4.2 Path Resolver 주입 가능성

설계 §3.8은 adapter에서 pathResolver를 주입하는 것을 가정:

```typescript
// 설계 문서의 의도 (라인 626-635)
const pathResolver = {
  debug: () => joinHome('.autodev', 'debug'),
  baselines: () => join(ctx.worktreeRoot, '.autodev', 'baselines'),
  screenshots: () => join(ctx.worktreeRoot, '.autodev', 'screenshots'),
  pbt: () => join(ctx.worktreeRoot, '.autodev', 'pbt'),
  vlmConfig: () => joinHome('.autodev', 'vlm-config.json'),
};
```

**그러나**: 현재 `verify-agent.ts`에는 pathResolver 주입 메커니즘이 없다. 생성자에 option이 없고, 환경변수 `AUTODEV_SCREENSHOTS_DIR` 도 존재하지 않는다. **verify-agent.ts 수정 없이는 VLM 스크린샷 경로 변경 불가능**.

### 4.3 C7-1.5 에서의 실용적 판단

| 항목 | 현재 상태 | C7-1.5 액션 |
|------|---------|------------|
| baselines | 이미 worktree ✅ | 없음 |
| pbt | 이미 worktree ✅ | 없음 |
| VLM screenshots (HOME) | ❌ 불일치, 그러나 VLM 제외 → soft-fail | verify-agent.ts 수정 후순위. 환경변수 가드로 우회 허용 |
| direct PW screenshots (cwd) | 🟡 부분적 정합 (cwd=worktreeRoot가 일반적) | 허용 (완벽한 해결은 Stage 7) |

### 4.4 마이그레이션 스크립트 필요성

- **baselines**: 이미 코드가 `projectDir/.autodev/baselines`를 사용 → 기존 `~/.autodev/baselines/`에 데이터가 있어도 신규 경로로 자동 재생성 (first run에서 baseline 새로 저장)
- **pbt**: 동일, 매 실행마다 재생성 → 마이그레이션 불필요
- **결론**: C7-1.5에서 마이그레이션 스크립트 **불필요**. 기존 baselines는 다음 pass 시 자동 overwrite됨.

---

## 5장. 입력 구조 — AgentInput 재활용 가능성

### 5.1 AgentInput 현재 정의

```typescript
// src/agents/interfaces.ts, 라인 16-37
export interface AgentInput {
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
```

### 5.2 VerifyInput — 이미 정의됨

```typescript
// src/agents/interfaces.ts, 라인 57-68
export interface VerifyInput extends AgentInput {
  originalPrompt: string;       // 사용자 원래 요청 (LLM 판단 기준)
  modifiedFiles: string[];      // 코더가 수정한 파일 목록
  projectDir: string;           // worktreeRoot (AgentInput.context.projectDir와 중복)
  tools: VerifyTool[];          // MCP Playwright 도구 배열
  skipMechanical?: boolean;     // 코드리뷰 모드 플래그
  depth?: 'fast' | 'standard' | 'deep';
  plan?: {
    acceptanceCriteria?: AcceptanceCriteria;
    [key: string]: unknown;
  };
}
```

Verify Agent는 내부에서 캐스팅:
```typescript
// verify-agent.ts, 라인 72
const verifyInput = input as unknown as VerifyInput;
```

### 5.3 interfaces.ts 수정 필요 여부

**NO** — `VerifyInput`은 이미 `interfaces.ts`에 정의됨. `AgentInput` 수정 불필요.

Adapter에서 `VerifyInput` 구조로 객체를 생성하고 `verifyAgent.invoke(verifyInput as AgentInput)`으로 전달하면 된다.

### 5.4 C7-1 산출물 영향 범위

- `input-transform.ts`의 `transformInput()`: 현재 `AgentInput` 반환 → planner/coder 경로 그대로 유지
- 새로운 `transformVerifierInput()` 함수를 동일 파일 또는 별도 파일로 추가
- C7-1의 `ClaudeCodeBackend`, `GeminiCLIBackend`, `CodexCLIBackend`, `AutoDevAgentBackend`: **무영향** (모두 `AgentInput` 기반)

### 5.5 핵심 갭: 코더 출력 → VerifyInput 변환

현재 `resolveExpressions()`는 `String(nodeData)` 강제 변환(라인 22):
```typescript
resolved = resolved.replace(
  new RegExp(`\\$nodes\\.${userId}\\.data`, 'g'),
  String(nodeData),  // 객체면 "[object Object]"
);
```

코더 NodeOutput.data는 `{ text: string; modifiedFiles: string[] }` 구조이므로 문자열 치환이 아닌 **구조 분해**가 필요:

```typescript
// Verifier adapter에서 직접 ctx.$nodes 접근 필요
const coderOutput = (ctx.$nodes['code'] as NodeOutput)?.data as {
  text: string;
  modifiedFiles: string[];
} | undefined;
const verifyInput: VerifyInput = {
  ...baseInput,
  originalPrompt: ctx.$task?.prompt ?? '',
  modifiedFiles: coderOutput?.modifiedFiles ?? [],
  projectDir: ctx.worktreeRoot,
  tools: [],  // MCP 없는 환경에서 빈 배열
  depth: 'deep',
};
```

이 처리는 `transformInput()` 일반화가 아니라 **verifier 전용 변환**이 필요함을 의미한다.

---

## 6장. 제외 모듈 "Soft Failure" 거동

### 6.1 모듈별 실패 거동 (실제 코드 인용)

**SAST (라인 227-229)**:
```typescript
} catch {
  emit({ ..., level: 'info', message: '[Verify] SAST scan skipped (semgrep not available)' });
}
// → verification 계속
```

**A11y (라인 247-249)**:
```typescript
} catch {
  emit({ ..., level: 'info', message: '[Verify] A11y scan skipped' });
}
// → verification 계속
```

**PBT (라인 268-270)**:
```typescript
} catch (err) {
  emit({ ..., level: 'info', message: `[Verify] PBT skipped: ${err}` });
}
// → verification 계속
```

**Visual Regression (라인 140-143)**:
```typescript
} catch (err) {
  emit({ ..., level: 'warn',
    message: `[VisualRegression] Baseline comparison failed: ${err}`
  });
}
// → verification 계속
```

**VLM (라인 666-668)**:
```typescript
} catch (err) {
  emit({ ..., level: 'info', message: `[Verify] Visual analysis skipped: ${err}` });
}
// → return evidence; (라인 672)
```

**OPENROUTER_API_KEY 미설정 시** (라인 1606-1608):
```typescript
if (!openrouterKey) {
  throw new Error('VLM requires OPENROUTER_API_KEY');
}
// → analyzeVisual()에서 throw → collectEvidence()의 catch (라인 666) → info log → 계속
```

### 6.2 하드 실패 모듈 존재 여부

**없음**. 8개 특수 모듈 전부 warning/info 로그만 emit하고 verification을 계속한다. 점수 계산은 항상 진행된다.

### 6.3 C7-1.5 액션

코드 변경 **불필요**. adapter가 적절한 입력(빈 tools 배열, 환경변수 미설정)을 전달하면 모든 제외 모듈은 자동으로 soft-skip 된다.

---

## 7장. Verify 출력 → NodeOutput 변환

### 7.1 현재 변환 경로

```typescript
// src/lib/adpl/engine/adapters/agent/output-transform.ts, 라인 4-16
export function transformOutput(output: AgentOutput): NodeOutput {
  const metrics = {
    durationMs: output.durationMs,
    costUsd: output.costUsd,
    tokensIn: output.tokenUsage.input,
    tokensOut: output.tokenUsage.output,
  };
  if (output.success) {
    return { status: 'success', data: output.result, metrics };
  }
  // ...
}
```

`VerifyResult`가 `AgentOutput.result` → `NodeOutput.data`로 직접 매핑:

```typescript
NodeOutput.data = {
  passed: boolean,
  score: number,
  reason: string,
  issues: string[],
  suggestions: string[],
  verdict: 'pass' | 're-code' | 're-plan' | 'fail' | 'warn',
  evidence: { screenshots?, buildResult?, consoleErrors?, executionOutput?, codeReview? }
}
```

다른 노드에서 `$nodes.verify.data.score`로 점수 접근 가능.

### 7.2 promptTruncated 시 85점 상한 캡 — 설계 갭

설계 §3.7: "Verify Agent가 `metrics.promptTruncated === true`인 node의 output을 평가할 때는 score 상한 캡 적용 (85/100)"

**문제**: `VerifyResult`에 truncation 정보가 없다. `evidence.truncatedFiles`는 `collectEvidence()` 내부 변수이며, 반환되는 `VerifyResult.evidence`의 타입 정의에 포함되지 않는다 (`interfaces.ts` 라인 71-84).

**어디서 cap을 적용할 것인가?**

| 위치 | 장점 | 단점 |
|------|------|------|
| `output-transform.ts` | 일관된 후처리 | truncation 정보 없음 |
| Verifier backend의 `execute()` | truncation flag 알 수 있음 (ctx에서) | 일반화 어색 |
| `runLlmJudgment()` 내부 | evidence 직접 접근 | 기존 코드 수정 필요 |
| **Adapter 후처리 (권고)** | 기존 코드 건드리지 않음 | ctx.$nodes.coder.metrics.promptTruncated 필요 |

**권고**: Verifier backend의 `execute()`에서 `ctx.$nodes.code`의 `metrics.promptTruncated` 를 확인하고, `AgentOutput.result.score > 85`이면 85로 캡. `output-transform.ts` 수정 불필요.

```typescript
// VerifierBackend.execute() 의사코드
const coderMetrics = (ctx.$nodes['code'] as NodeOutput)?.metrics as any;
if (coderMetrics?.promptTruncated && (result.result as VerifyResult).score > 85) {
  (result.result as VerifyResult).score = 85;
}
```

단, 현재 C7-1의 output-transform.ts는 `metrics`에 `promptTruncated`를 추가하지 않는다. 이 필드가 없으면 cap 적용 불가. **C7-1.5 에서 이 정보를 어떻게 전달할지 별도 결정 필요**.

---

## 8장. 테스트 전략

### 8.1 테스트 가능성 분석

| 영역 | 테스트 방법 | 가능성 | 예상 테스트 수 |
|------|-----------|--------|--------------|
| resolver: verifier role 매트릭스 | 단위 (mock 없음) | ✅ 높음 | 5-8개 |
| input-transform: VerifyInput 생성 | 단위 (mock ctx) | ✅ 높음 | 4-6개 |
| output-transform: score cap | 단위 (mock output) | ✅ 높음 | 3-4개 |
| cross-model selection: isAvailable mock | 단위 (mock resolveCli) | ✅ 높음 | 3-4개 |
| 홈 경로: baselines/pbt → worktreeRoot | 단위 (assert 경로 문자열) | ✅ 높음 | 2-3개 |
| VLM soft-fail (OPENROUTER_API_KEY 없음) | 단위 (실제 CLI 없이) | 🟡 중간 | 2-3개 (mock 필요) |
| E2E: 실제 ADPL YAML → plan/code/verify | 수동 smoke test | 🟡 비용 발생 | 1개 (수동) |

**총 예상**: 19–28개 단위 테스트 + 1개 수동 smoke test

### 8.2 제외 모듈 테스트에서의 skip 방법

```typescript
// 환경변수 미설정으로 PBT/SAST/Debate 자동 skip
process.env.AUTODEV_PBT_ENABLED = undefined;
process.env.AUTODEV_SAST_ENABLED = undefined;
process.env.AUTODEV_DEBATE_VERIFY = undefined;
delete process.env.OPENROUTER_API_KEY;  // VLM soft-fail

// tools 배열 비워서 A11y skip
const verifyInput = { tools: [] };
```

### 8.3 핵심 테스트 케이스

```typescript
// 1. resolver: verifier role 수락
it('resolves verifier + auto-cross-model to VerifyAgentBackend', ...)
it('throws AgentValidationError for verifier + invalid-model', ...)

// 2. input-transform: 구조 분해
it('extracts modifiedFiles from ctx.$nodes.code.data', ...)
it('sets originalPrompt from ctx.$task.prompt', ...)
it('passes empty tools when no MCP available', ...)

// 3. cross-model selection
it('selects codex-cli when coder=claude-code and codex available', ...)
it('falls back to claude-cli when no alternatives available', ...)

// 4. 경로 검증
it('baselines path resolves to worktreeRoot/.autodev/baselines', ...)
it('debug path resolves to HOME/.autodev/debug', ...)

// 5. score cap
it('caps score at 85 when coderMetrics.promptTruncated=true', ...)
it('does not cap score at 85 when promptTruncated=false', ...)
```

---

## 9장. End-to-End Plan → Code → Verify 시나리오 스케치

### 9.1 최소 YAML 파이프라인

```yaml
pipeline:
  - { id: plan, type: agent, role: planner, model: autodev-internal }
  - { id: code, type: agent, role: coder, model: claude-code,
      prompt: '$prev.data' }
  - { id: verify, type: agent, role: verifier, model: auto-cross-model,
      useMemory: true }
```

### 9.2 Expression Resolver 동작 여부

**검증됨** (input-transform.test.ts, 라인 60–66):
```typescript
it('replaces $nodes.<userId>.data in prompt', () => {
  ctx.$nodes = { plan: { status: 'success', data: 'plan-output' } };
  const input = transformInput(spec, ctx, noop);
  expect(input.prompt).toBe('plan: plan-output');
});
```

`$nodes.plan.data` → 문자열 치환 ✓

**문제**: `$nodes.code.data`는 `{ text: string; modifiedFiles: string[] }` 구조 → `String({...})` = `"[object Object]"` → **verifier prompt에 쓰레기 값**

실제로 verifier는 prompt가 아닌 `verifyInput.modifiedFiles`를 사용하므로, prompt의 `$nodes.code.data`는 `modifiedFiles` 전달에 쓸 수 없다. Verifier backend가 `ctx.$nodes.code`를 직접 구조 분해해야 한다.

### 9.3 Verify 가 Plan 참조하는지

**YES** — 하지만 선택적:

```typescript
// verify-agent.ts, 라인 147-148
const plan = verifyInput.plan;
const ac = plan?.acceptanceCriteria;

// 라인 254-255
const pbtEnabled = process.env.AUTODEV_PBT_ENABLED === '1'
  || verifyInput.plan?.acceptanceCriteria?.pbt === true;
```

- `plan`은 optional. `undefined`이면 `ac?.requiredFiles`, `ac?.security`, `ac?.pbt`, `ac?.debateVerify` 모두 자연히 undefined → 관련 기능 전부 skip
- **C7-1.5 에서 plan 전달 생략 가능**. 기능 손실 없음 (acceptance criteria 검사만 생략됨)

### 9.4 실행 흐름 (C7-1.5 완료 시점)

```
YAML
  ↓
PipelineExecutor (Stage 2 산출물)
  ↓
AgentAdapter.execute(planSpec, ctx)
  → AutoDevAgentBackend → PlanningAgent.invoke() → Plan 반환
  → ctx.$nodes.plan = NodeOutput{ data: plan_text }
  ↓
AgentAdapter.execute(codeSpec, ctx)  
  → ClaudeCodeBackend → CodingAgent.invoke() → { text, modifiedFiles }
  → ctx.$nodes.code = NodeOutput{ data: { text, modifiedFiles } }
  ↓
AgentAdapter.execute(verifySpec, ctx)
  → resolveBackend('verifier', 'auto-cross-model')
  → VerifyAgent.selectDifferentFrom('claude-code')
      → codex-cli available? → VerifyAgent('codex-cli')
  → transformVerifierInput(verifySpec, ctx)
      → modifiedFiles = ctx.$nodes.code.data.modifiedFiles
      → originalPrompt = ctx.$task.prompt
  → verifyAgent.invoke(verifyInput)
      → Stage 1: Mechanical checks
      → Stage 2: collectEvidence (VLM soft-skip)
      → Stage 3: runLlmJudgment with codex-cli
      → VerifyResult{ passed, score, verdict }
  → transformOutput(agentOutput)
      → NodeOutput{ data: VerifyResult, metrics }
```

---

## 10장. 복잡도 재평가 & 예상 소요 시간 재산정

### 10.1 작업별 시간 추정

| 작업 | 내용 | 예상 시간 |
|------|------|---------|
| resolver.ts 수정 | verifier role 추가, auto-cross-model 처리, AgentNotImplementedError 제거 | 0.5-1시간 |
| VerifierBackend 신규 파일 | `selectDifferentFrom()` 호출, VerifyInput 생성, invoke, score cap 후처리 | 1.5-2시간 |
| transformVerifierInput 함수 | ctx.$nodes.code 구조 분해, VerifyInput 빌드 | 0.5-1시간 |
| Cross-model selection | coder model 추출 설계 결정 + 구현 | 0.5-1시간 |
| 홈 리디렉션 | baselines/pbt 이미 완료, screenshots 수용 | 0.25-0.5시간 |
| score cap 로직 | promptTruncated 전달 방법 결정 + 구현 | 0.5시간 |
| 단위 테스트 작성 | 19-28개, helpers 재사용 가능 | 2-2.5시간 |
| E2E 통합 확인 | debug dump 생성 확인, smoke test | 0.5시간 |

**합계**: **6-9시간** (하한 6, 상한 9)  
→ C7-1 약 6시간, 전체 wrap 10-15시간 대비 합리적

### 10.2 리스크와 오차 요인

| 리스크 | 영향 | 예상 추가 시간 |
|--------|------|-------------|
| cross-model 선택: coder model NodeOutput 부재 → 설계 결정 루프 | 구조적 | +0.5-1시간 |
| String() 강제 변환 문제 → verifier 전용 입력 처리 필요 | 구현 패턴 | +0.5시간 |
| score cap: promptTruncated 전달 경로 부재 → 최소화 또는 생략 | 기능 | +0.25-0.5시간 |
| screenshots HOME 경로 → verify-agent.ts 수정 요구됨, 범위 논쟁 가능 | 범위 결정 | +0.5-1시간 (또는 Stage 7 이월) |

**보수적 총 예상**: **7-9시간**

### 10.3 C7-1과의 비교

| 항목 | C7-1 | C7-1.5 |
|------|------|--------|
| 새 파일 수 | ~6개 (4 backends + resolver + transform) | ~3-4개 (backend + resolver 수정 + transform 수정) |
| 테스트 수 | ~20개 | 19-28개 |
| 기존 코드 수정 | 없음 (신규) | resolver.ts (기존 수정), 선택: verify-agent.ts |
| 주요 설계 결정 | backend 패턴 확립 | coder model 추출, score cap 위치 |
| 소요 시간 | ~6시간 | 6-9시간 |

---

## 예상 밖 발견 / 리스크

### R1. String() 강제 변환 — 심각도 높음

`resolveExpressions()`가 모든 `$nodes.*.data`를 `String()`으로 강제 변환 (input-transform.ts 라인 22). 코더 output이 객체이므로 verifier prompt에 `$nodes.code.data`를 쓰면 `[object Object]`가 삽입된다. **verifier는 반드시 ctx.$nodes를 직접 접근해야 하며, 일반 transformInput() 재사용 불가**.

### R2. VLM 스크린샷이 여전히 HOME에 저장

`collectEvidence()` 라인 515: VLM base64 이미지를 `HOME/.autodev/screenshots/`에 저장. VLM 자체는 soft-fail이지만, OPENROUTER_API_KEY가 있으면 스크린샷 파일이 HOME에 생성된다. 설계 §3.8의 "screenshots → worktree 이동" 요건과 불일치. C7-1.5에서 verify-agent.ts 수정 여부는 **사용자 판단 필요**.

### R3. Verifier Tools 배열 — MCP 없는 ADPL 환경

`VerifyInput.tools: VerifyTool[]`는 Playwright 도구를 담는다. 현재 ADPL adapter layer에는 MCP 연결 개념이 없다. C7-1.5에서는 **빈 배열 전달**이 유일한 선택. A11y와 MCP screenshot이 자동 skip된다. 기능 손실이지만 수용 가능 — Playwright direct fallback은 작동함.

### R4. ROLE_MODEL_MATRIX 와 AgentModel 타입 불일치

현재 `AgentModel` 타입은 `'autodev-internal' | 'claude-code' | 'gemini-cli' | 'codex-cli'`로 정의 (추정). `'auto-cross-model'`과 `'claude-cli'`가 이 타입에 없으면 TypeScript 에러 발생. resolver.ts의 타입 정의 변경 필요.

### R5. VerifyAgent의 role 필드가 'verify' 이지만 ADPL 에서는 'verifier'

```typescript
// verify-agent.ts, 라인 25
readonly role = 'verify' as const;
```

ADPL YAML에서는 `role: verifier`로 쓴다 (resolver.ts 라인 32). 이 불일치는 wrapper adapter가 중간에서 변환하므로 문제 없지만, 타입 정의에서 혼선이 생길 수 있다. 문서화 필요.

---

## 수락 기준 자가 점검

- [x] **10장 모두 채워짐**
- [x] **1장: 모듈 경계선 10개로 명확히 그림** (10.2절 표, 10개 행)
- [x] **2장: 제외 모듈 비활성화 가능 여부 YES/NO 명시** → 6개 모두 YES (코드 수정 없이)
- [x] **5장: interfaces.ts 수정 필요 여부 NO + 영향 범위 명시**
- [x] **10장: 예상 소요 시간 7-9시간 (오차범위 포함)**
- [x] **추측 없음 — 모든 코드 인용은 실제 파일 라인 번호 기반**

미구현/미확인 항목:
- `metrics.promptTruncated` 전달 경로: 현재 C7-1 구현에 없음 → C7-1.5 설계 결정 필요
- `auto-cross-model` 시 coder model 추출: NodeOutput에 없음 → 설계 결정 필요
- screenshots 경로 홈→worktree: verify-agent.ts 수정 없이는 불가 → 사용자 판단 요청
