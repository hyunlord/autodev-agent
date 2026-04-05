# AutoDev Agent v2 — 에이전트 아키텍처 재설계

> 82 commits, 66 source files 기반. 근본적 구조 변경.

---

## 1. 왜 재설계하는가

### 현재 구조의 근본 문제

**Planning이 너무 많이 함:**
- 뭘 만들지 결정 (계획)
- 어떻게 검증할지도 결정 (verificationSpec, expectedText 하드코딩)
- Planning이 `id="count"` 넣었는데 Coding이 `id="counter"` 쓰면 → Verification 실패
- Planning이 모든 걸 미리 알 수 없음 → 불가능한 구조

**Verification이 자기 판단 없음:**
- Planning이 정한 체크리스트를 기계적으로 실행
- "이게 진짜 요청을 만족하는지"는 안 봄
- Godot, CLI, API 등 다양한 작업 유형에 대응 못 함
- 결과물을 브라우저에서 열어서 클릭해보는 수준의 검증 없음

**Coding이 혼자 다 함:**
- 하나의 에이전트가 전체 작업을 처리
- 병렬 작업 불가
- 자기가 짠 코드를 자기가 "성공"이라 보고

**레이어 1(개발)과 레이어 2(서비스) 둘 다 같은 문제:**
- 레이어 1: Claude Code가 코딩하고 자기가 "빌드 통과"라 보고 → 실제론 타입 에러
- 레이어 2: Planning이 expectedText 하드코딩 → Coding과 불일치 → 실패

### 발견된 버그 목록 (verify가 못 잡은 것들)

| 버그 | 원인 | verify가 못 잡은 이유 |
|------|------|---------------------|
| file_check 절대 경로 이중 join | join(cwd, absolutePath) | 빌드만 봤으니까 |
| Codex CLI sandbox read-only | --sandbox 옵션 누락 | Codex로 안 돌려봤으니까 |
| Codex CLI stdin 안 먹힘 | 파이핑 방식 문제 | 긴 프롬프트 안 돌려봤으니까 |
| Planning expectedText 불일치 | id="count" vs id="counter" | 기계적 체크만 하니까 |
| Retry가 뭘 고쳐야 하는지 모름 | 에러 메시지만 전달 | retry 흐름 미테스트 |
| gitStatus TypeScript 에러 | optional chaining 누락 | 자기 코드를 자기가 검증 |

---

## 2. 새 아키텍처 — 핵심 원칙

```
1. 모든 작업은 독립 에이전트들의 협업
2. 각 에이전트는 자기 역할만 (다른 역할 침범 안 함)
3. Verify Agent는 반드시 Coding Agent와 다른 LLM
4. Verify Agent가 검증 방법도 스스로 결정 (하드코딩 아님)
5. 기준 미달 시 Plan부터 다시 (Coding retry가 아님)
6. 같은 프레임워크가 레이어 1과 레이어 2에 다 적용
7. 설정만 다르게 — .autodev/ 구조로 관리
```

---

## 3. 에이전트 구조

### 3.1 필수 에이전트

```
Planning Agent (1개):
  역할: 프로젝트를 분석하고 구체적 실행 계획을 짬
  입력: 사용자 프롬프트 + 프로젝트 컨텍스트 (git, 파일, 의존성)
  출력: { summary, tasks: [{ description, files, agent }], estimatedFiles }
  안 하는 것: verificationSpec 생성 ← 이건 Verify Agent 역할
  LLM: claude-code / codex-cli / gemini-cli / claude-api

Coding Agent (1개 이상 — 병렬/순차):
  역할: 계획에 따라 코드 작성
  입력: task description + 프로젝트 디렉토리
  출력: { modifiedFiles, code, buildResult }
  안 하는 것: 계획, 검증
  LLM: claude-code / codex-cli / gemini-cli / aider / cline
  확장: 여러 에이전트가 다른 파일/모듈을 병렬로 작업 가능

Verify Agent (1개 — Coding과 반드시 다른 LLM):
  역할: 결과물이 원래 요청을 만족하는지 직접 판단
  입력: 원래 프롬프트 + 생성된 파일 + (필요시) 스크린샷/실행 결과
  출력: { passed, score, reason, issues, suggestions }
  하는 것:
    1. 기계적 체크 (빌드, 파일 존재) — 빠르고 토큰 0
    2. 작업 유형을 보고 검증 방법을 스스로 결정
    3. LLM이 코드 + 결과물을 보고 "요청을 만족하는지" 판단
    4. 필요하면 Playwright/실행/VLM 등을 도구로 사용
  규칙: Coding Agent와 다른 LLM 사용 (자기 합리화 방지)
  실패 시: Plan부터 다시 (Coding만 retry 아님)
```

### 3.2 확장 에이전트

```
Interview Agent:
  역할: 모호한 요청 시 사용자에게 질문
  현재: pipeline.ts에 박혀있음 → 독립 에이전트로 분리

Review Agent:
  역할: 코드 품질 리뷰 (Verify와 별개)
  Verify: "동작하는가?" / Review: "잘 짰는가?"

Evaluate Agent:
  역할: 최종 점수/등급 (A/B/C/F)
  Verify + Review 결과를 종합
```

### 3.3 에이전트 선택

```
자동 선택 (기본):
  Planning: 사용 가능한 CLI 중 자동
  Coding: 작업 유형에 맞는 에이전트 추천 (기존 agent-selector)
  Verify: Coding과 다른 LLM 자동 선택
    ex) Coding이 Claude → Verify는 Codex 또는 Gemini
    ex) Coding이 Codex → Verify는 Claude

사용자 선택:
  대시보드에서 각 단계별 에이전트 직접 지정 가능
```

### 3.4 Planning 토론 모드 (Debate Mode)

Planning Agent가 혼자 계획을 짜면 빠뜨리는 게 생긴다.
복잡한 작업에서는 여러 역할의 에이전트가 토론하면서 계획을 다듬는다.

#### 토론 참여 에이전트

```
Planner: 계획을 제안한다
  "index.html, style.css, script.js 3개 만들자"

Questioner: 빠뜨린 부분을 질문한다
  "DOM 로드 타이밍은? 모바일 레이아웃은? 에러 핸들링은?"

Skeptic: 계획의 약점을 공격한다
  "3개 파일 따로 만들면 경로 참조 틀릴 수 있어.
   하나의 index.html이 더 안전하지 않아?"

→ Planner가 피드백을 반영해서 최종 계획 확정
```

#### 토론 흐름

```
Round 1: Planner → 초안
Round 2: Questioner → 질문 → Planner → 답변/수정
Round 3: Skeptic → 약점 지적 → Planner → 방어/수정
Round 4: (필요시) 추가 라운드
Final: Planner → 확정된 계획 출력
```

#### Planning 모드 선택

```
Quick (기본):
  Planner 혼자. 빠르고 저렴.
  간단한 작업에 적합 ("카운터 만들어줘")

Deliberate:
  Planner + Questioner. 빠뜨린 부분 체크.
  중간 복잡도 ("로그인 + 대시보드 만들어줘")

Debate:
  Planner + Questioner + Skeptic. 계획을 공격하고 방어.
  복잡한 작업에 적합 ("OAuth + 결제 + 대시보드")
```

#### 자동 선택 기준

```
프롬프트 길이 + 기술 스택 수 + 예상 파일 수로 복잡도 추정:
  간단 (1-3 파일, 단일 스택) → Quick
  중간 (4-10 파일, 2+ 스택) → Deliberate
  복잡 (10+ 파일, 다중 스택, 인프라 포함) → Debate
사용자가 직접 선택도 가능.
```

#### 비용 고려

```
Quick: LLM 1회 호출
Deliberate: LLM 3-4회 호출 (Planner + Questioner + 수정)
Debate: LLM 5-7회 호출 (Planner + Questioner + Skeptic + 수정들)
→ 복잡한 작업은 Planning에 돈을 써서 Coding 재작업을 줄이는 전략
```

#### 구현 시점

Phase R2 (Planning Agent를 IAgent로 분리할 때) 에서 구현.
R1 (Verify Agent)이 먼저.

#### 참조 흐름도

`docs/reference/worldsim_harness_pipeline_flow.svg` — 다른 프로젝트의 하네스 파이프라인 흐름도.
Planning debate loop (Drafter → Challenger → QC), Generator 격리, Visual verification, Evaluator, pre-commit hook 구조가 포함.

핵심 참조 패턴:
- **Agent isolation**: 각 에이전트가 볼 수 있는 정보를 제한 (자기 합리화 방지)
  - Drafter: full project context
  - Challenger: plan만 봄 (격리)
  - Generator: plan + prompt만 (격리)
  - Evaluator: 결과물만, reasoning 못 봄
- **Planning debate loop**: Drafter → Challenger → Revision → QC (max 2 rounds)
- **Visual verification**: 실행 → 스크린샷 → VLM 분석 (별도 단계)
- **pre-commit hook**: verdict 파일 확인 → 통과해야 커밋

---

## 4. 파이프라인 — 에이전트 오케스트레이션

### 4.1 실행 흐름

```
1. [Interview Agent]  — executionMode === 'interview'면 질문 먼저
2. [Planning Agent]   — 프로젝트 분석 → 실행 계획 생성
3. [Plan Review]      — 사용자 승인 (에이전트 아님, UI 대기)
4. [Coding Agent(s)]  — 계획에 따라 코드 작성 (병렬/순차)
5. [Verify Agent]     — 결과물을 직접 판단 (독립 LLM)
6. 분기:
   PASS (score >= 기준) → 완료
   FAIL (점수 부족) → Plan부터 다시 (2번으로)
     Verify Agent의 issues + suggestions를 Planning Agent에 전달
     "이전 계획의 문제점: X. 다시 계획해라."
   PARTIAL (일부만 통과) → Coding만 retry (4번으로)
     Verify Agent의 구체적 fix 지시를 Coding Agent에 전달
```

### 4.2 실패 시 재시도 전략

```
현재:
  Verify 실패 → Coding만 retry (최대 3번) → 전부 실패 → escalation

After:
  Verify 실패 → Verify Agent가 판단:
    "코드가 근본적으로 틀림" → Plan부터 다시 (re-plan)
    "코드는 맞는데 일부 빠짐" → Coding retry + 구체적 지시
    "빌드 에러" → Coding retry + 에러 메시지 전달
  
  re-plan 시:
    Planning Agent에게 이전 계획 + Verify Agent의 피드백 전달
    "이전 계획으로 만든 결과가 X 이유로 실패. 다시 계획해라."
    
  최대 시도:
    Coding retry: 3회
    Re-plan: 2회
    총 최대: 3 × 2 = 6회 Coding + 2회 Planning
    비용 상한: ProgressDetector 적용
```

---

## 5. Verify Agent 상세

### 5.1 검증 방법을 스스로 결정

```
Verify Agent는 하드코딩된 전략 매핑이 아니라,
결과물을 보고 "이걸 어떻게 검증해야 하지?"를 LLM이 판단.

Verify Agent 프롬프트:
"사용자가 X를 요청했고, 코드가 생성되었다.
 이 코드가 요청을 만족하는지 검증하라.

 사용 가능한 도구:
 - file_read: 파일 내용 읽기
 - shell_exec: 명령 실행 (빌드, 서버 시작 등)
 - playwright: 브라우저로 페이지 열기, 스크린샷, 클릭
 - screenshot_vlm: 스크린샷을 시각적으로 분석

 어떤 도구를 쓸지는 네가 판단해.
 HTML 파일이면 브라우저로 열어봐.
 API 서버면 curl로 호출해봐.
 CLI 도구면 실행해봐.
 Godot 프로젝트면 빌드하고 스크린샷 찍어봐."

→ Verify Agent가 도구를 선택해서 검증
→ 작업 유형이 뭐든 대응 가능
→ 새로운 유형이 나와도 코드 수정 불필요
```

### 5.2 Verify Agent에게 제공하는 것

```
항상 제공:
  - 원래 사용자 프롬프트
  - 생성/수정된 파일 목록
  - 각 파일의 내용 (큰 파일은 앞뒤 + 요약)
  - 빌드 결과 (있으면)

도구로 제공 (Agent가 필요하면 호출):
  - file_read: 추가 파일 읽기
  - shell_exec: 명령 실행
  - playwright_open: 브라우저로 URL/파일 열기
  - playwright_screenshot: 스크린샷
  - playwright_click: 요소 클릭
  - playwright_evaluate: JS 실행
```

### 5.3 Verify Agent 출력

```json
{
  "passed": false,
  "score": 65,
  "reason": "카운터 UI는 렌더되지만 Reset 버튼이 없고, - 버튼이 음수까지 감소함",
  "issues": [
    "Reset 버튼이 없음 — 사용자가 '리셋' 기능을 요청했음",
    "감소 버튼이 음수까지 내려감 — 0 이하 방지 필요"
  ],
  "suggestions": [
    "Reset 버튼 추가: <button id='reset'>Reset</button>",
    "감소 핸들러에 Math.max(0, count - 1) 적용"
  ],
  "verdict": "re-code",
  "evidence": {
    "screenshots": ["screenshot-initial.png", "screenshot-after-click.png"],
    "buildResult": "N/A (static HTML)",
    "consoleErrors": []
  }
}
```

verdict 값:
- `"pass"` — 완료
- `"re-code"` — Coding만 retry (구체적 fix 지시와 함께)
- `"re-plan"` — Plan부터 다시 (근본적 문제)
- `"fail"` — 해결 불가 (escalation)

---

## 6. 두 레이어에 같은 프레임워크 적용

### 6.1 레이어 1 — AutoDev 서비스 자체 개발

```
대상: AutoDev 소스 코드 (src/, scripts/, .autodev/)
목적: "코드 수정 후 서비스가 제대로 동작하는가"

Planning Agent: Claude Code가 구현 계획 (내가 방향 지시)
Coding Agent: Claude Code가 코드 수정
Verify Agent: Gemini CLI 또는 Codex CLI (다른 LLM)
  1. pnpm build 통과하는가 (기계적)
  2. API 엔드포인트 200 나오는가 (기계적)
  3. 변경된 코드가 의도대로인가 (LLM 코드 리뷰)
  4. 서비스 E2E — 실제 작업 실행해서 성공하는가 (레이어 2 파이프라인 호출)

실행: pnpm verify (quick) / pnpm verify:e2e (full)
설정: CLAUDE.md + .autodev/agents/ (AutoDev 프로젝트용)
```

### 6.2 레이어 2 — 사용자 작업 처리

```
대상: 사용자 프로젝트 (워크스페이스)
목적: "사용자가 요청한 것이 실제로 만들어지고 동작하는가"

Planning Agent: claude-cli / codex-cli / gemini-cli / claude-api
Coding Agent(s): claude-code / codex-cli / gemini-cli (병렬 가능)
Verify Agent: Coding과 다른 LLM
  1. 파일 존재 + 빌드 (기계적)
  2. 작업 유형 판단 + 검증 방법 결정 (LLM)
  3. 결과물 검증 — 코드 리뷰 + 브라우저/실행/VLM (LLM + 도구)
  4. 최종 판단: passed/score/reason

실행: Pipeline 자동 실행
설정: 각 프로젝트의 .autodev/agents/ (사용자 커스텀 가능)
```

### 6.3 공통 프레임워크

```
두 레이어 모두:
  같은 IAgent 인터페이스
  같은 오케스트레이션 로직 (Pipeline)
  같은 Verify Agent 구조
  같은 .autodev/ 설정 형식
  
  차이:
  - 대상 프로젝트가 다름
  - 사용하는 LLM 조합이 다를 수 있음
  - 레이어 1은 추가로 E2E (레이어 2 호출)
```

---

## 7. IAgent 공통 인터페이스

```typescript
interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly role: AgentRole;
  readonly llm: string;

  isAvailable(): Promise<boolean>;
  invoke(input: AgentInput): Promise<AgentOutput>;
}

type AgentRole = 'planning' | 'coding' | 'verify' | 'interview' | 'review' | 'evaluate';

interface AgentInput {
  prompt: string;
  context: {
    projectDir: string;
    projectType: string;
    files: string[];          // 현재 파일 목록
    gitStatus: string;        // git 상태
    previousResults?: any;    // 이전 에이전트 결과
    verifyFeedback?: any;     // Verify Agent 피드백 (re-plan/re-code 시)
  };
  config: {
    harness: Record<string, any>;  // .autodev/ 설정
    systemPrompt?: string;         // 사용자 프리셋
    maxBudgetUsd?: number;
    timeoutMs?: number;
  };
  tools?: AgentTool[];        // 사용 가능한 도구 (Verify Agent용)
}

interface AgentOutput {
  success: boolean;
  result: any;                // 에이전트마다 다른 결과 형태
  costUsd: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
  rawOutput?: string;
}

// Verify Agent 전용
interface VerifyOutput extends AgentOutput {
  result: {
    passed: boolean;
    score: number;            // 0-100
    reason: string;
    issues: string[];
    suggestions: string[];
    verdict: 'pass' | 're-code' | 're-plan' | 'fail';
    evidence: {
      screenshots?: string[];
      buildResult?: string;
      consoleErrors?: string[];
      executionOutput?: string;
    };
  };
}

// Verify Agent가 사용할 수 있는 도구
interface AgentTool {
  name: string;    // 'file_read' | 'shell_exec' | 'playwright_open' | ...
  description: string;
  execute(params: any): Promise<any>;
}
```

---

## 8. 파일 구조 변경

```
현재 (v1):
  src/worker/pipeline.ts          ← 1158줄, planning+coding+verify 전부
  src/worker/planning.ts          ← planning 로직
  src/worker/verification.ts      ← 기계적 체크만
  src/worker/retry.ts             ← retry 로직
  src/lib/plugins/agents/         ← coding agent만
  src/lib/plugins/verifiers/      ← file_check, build_check 등

After (v2):
  src/agents/
    interfaces.ts                 ← IAgent 공통 인터페이스
    registry.ts                   ← 에이전트 등록/검색
    
    planning/
      planning-agent.ts           ← Planning Agent 공통 로직
      adapters/
        claude-cli.ts
        codex-cli.ts
        gemini-cli.ts
        claude-api.ts
    
    coding/
      coding-agent.ts             ← Coding Agent 공통 로직
      adapters/
        claude-code.ts
        codex-cli.ts
        gemini-cli.ts
        aider.ts
        cline-cli.ts
    
    verify/
      verify-agent.ts             ← Verify Agent (LLM 기반 판단)
      tools/                      ← Verify Agent가 사용하는 도구들
        file-read.ts
        shell-exec.ts
        playwright.ts             ← 브라우저 열기/스크린샷/클릭
        vlm-analyze.ts            ← 스크린샷 시각 분석
      mechanical/                 ← 기계적 체크 (Stage 1, 토큰 0)
        build-check.ts
        file-exists.ts
    
    interview/
      interview-agent.ts          ← pipeline에서 분리
    
    review/
      review-agent.ts             ← 코드 품질 리뷰 (선택)

  src/orchestrator/
    pipeline.ts                   ← 에이전트 오케스트레이션만 (얇게)
    retry-strategy.ts             ← re-code / re-plan / fail 판단
    progress-detector.ts          ← 비용/진전 감지 (기존 이동)

  src/harness/                    ← .autodev/ 설정 로딩 (기존 이동)
    prompt-loader.ts
    mcp-manager.ts
    context-builder.ts
```

---

## 9. 구현 순서

### Phase R1 — Verify Agent (핵심)
```
1. IAgent 인터페이스 정의
2. Verify Agent 구현 (LLM 기반 판단)
3. Verify Agent 도구 구현 (file_read, shell_exec, playwright)
4. Planning에서 verificationSpec 제거
5. Pipeline에서 Verify Agent 호출로 교체
6. verdict 기반 재시도 (re-code / re-plan)
```

### Phase R2 — Planning/Coding Agent 분리
```
1. Planning Agent를 IAgent로 통일
2. Coding Agent를 IAgent로 통일
3. Pipeline을 순수 오케스트레이터로 리팩터 (얇게)
4. Interview Agent 분리
```

### Phase R3 — 병렬 Coding
```
1. Planning이 여러 task로 분해
2. 각 task를 다른 Coding Agent에게 할당
3. 결과 병합 + 충돌 해결
```

### Phase R4 — 레이어 1 적용
```
1. pnpm verify를 Verify Agent 기반으로 교체
2. E2E 테스트를 레이어 2 파이프라인 호출로
3. CLAUDE.md 규칙을 .autodev/ 설정으로 통합
```

---

## 10. 현재 → v2 마이그레이션

### 유지하는 것
- Coding Agent 어댑터 5개 (claude-code, codex-cli, gemini-cli, aider, cline)
- 기계적 체크 (build-check, file-exists) — Verify Agent Stage 1에서 사용
- Harness 설정 구조 (.autodev/)
- DB 스키마 (tasks, attempts, verifications, events)
- UI (대시보드, Task Detail)
- ContextBuilder, MCP Manager
- ProgressDetector, RetryController (로직 유지, 위치 이동)
- Safety (command-checker, AbortController)

### 바꾸는 것
- pipeline.ts 1158줄 → orchestrator 200줄 이하
- verification.ts 437줄 → verify-agent.ts (LLM 기반)
- Planning이 verificationSpec 생성 → 안 함
- file_check expectedText → Verify Agent가 직접 판단
- Coding retry만 → re-plan 가능
- 에이전트 인터페이스 통일 (ICodingAgent → IAgent)

### 삭제하는 것
- verificationSpec/expectedText 하드코딩 관련 코드
- file-check의 expectedText 매칭 로직 (Verify Agent가 대체)
- Planning 프롬프트의 RULE 2 (verification spec 규칙)

---

## 11. 핵심 기억사항

- **Planning은 계획만.** Verification 기준을 Planning이 정하지 않는다.
- **Verify Agent는 독립 LLM.** Coding과 반드시 다른 LLM.
- **Verify Agent가 검증 방법을 스스로 결정.** 전략을 하드코딩하지 않는다.
- **실패 시 Plan부터 다시 가능.** Coding retry만이 아님.
- **같은 프레임워크, 두 레이어.** 설정만 다르게.
- **Coding은 병렬 가능.** 하나의 계획을 여러 에이전트가 나눠 작업.
- **현재 코드를 전부 버리는 게 아님.** 어댑터, 기계적 체크, 설정 구조는 유지.
