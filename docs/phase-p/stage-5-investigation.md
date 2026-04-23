# Stage 5 사전 조사

> 작성일: 2026-04-23
> 조사 목적: Stage 5 진입 전 로드맵·이월 항목·코드 현황 파악

---

## 1장. 로드맵 v7 §4.6 Stage 5 구성

로드맵 v7 (`AutoDev_로드맵_v7.md`) §3 테이블에서 Stage 5 관련 내용:

```
| 5 | Triggers + Expression | 2-3주 |
| — | **v0.5 Beta 출시 후보** | — |
```

### 명시 사항

- **범위**: Triggers + Expression
- **예상 기간**: 2-3주
- **위치**: Stage 5 완료 = v0.5 Beta 출시 후보 시점
- **Stage 5 이후**: Stage 6 (Durability + Observability, 2주), Stage 7 (UX + AI Builder, 3-4주)

로드맵 v7 에는 Stage 5 의 세부 작업 블록(D-단위) 분해가 없음.
Stage 2~4 처럼 진입 시 사전 조사 + 블록 분해가 필요.

### 로드맵 v7 §4 H7 출시 시나리오 A

> 시나리오 A: v0.5 Beta 시점 출시 (Stage 5 완료 후)
> - 예상 시점: Week 14-16 (약 4개월 후)
> - Phase P 파이프라인 기능 일부 검증됨

Stage 5 는 외부 공개 가능성이 있는 마일스톤. 안정성과 완성도가 Stage 2~4 보다 중요.

### 참고: 로드맵 원본에서 Stage 5 에 할당된 주제

로드맵 원본은 "Triggers + Expression" 이라고만 기재.
하지만 Stage 3·4 retro 에서 이월된 항목이 9건 이상이며, 이들 대부분이 Stage 5 에 배치됨.
실질적인 Stage 5 범위는 로드맵 원문보다 넓다.

---

## 2장. 이월 항목 매핑

| # | 항목 | 출처 | 로드맵 §4.6 배치 | 상태 |
|---|------|------|----------------|------|
| 1 | Jexl string condition (`"$nodes.score >= 80"`) | Stage 4 retro #2 | Triggers + Expression — ○ | △ 로드맵은 "Expression"으로 포괄. 구체적 Jexl 언급 없음 |
| 2 | DB-backed StateStore + checkpoint resume | Stage 4 retro #3 | 로드맵 Stage 6 (Durability) | △ retro 는 "Stage 5+"라 하지만 로드맵은 Stage 6 |
| 3 | continueOnIterationFailure 구현 | Stage 4 retro #4 | Stage 5 — ○ | ○ 스키마 존재, 핸들러 부분 구현 |
| 4 | break/continue in loop | Stage 4 retro #5 | Stage 5+ — ○ | △ breakCondition 스키마만 존재, break/continue 노드 타입 미정의 |
| 5 | human-approval gate (Slack 알림 → 응답 대기) | Stage 4 retro #6 | Stage 5+ | △ 로드맵 명시 없음. 별도 설계 필요 |
| 6 | `$nodes` 실제 주입 (FlowNodeHandler → 이전 노드 출력 참조) | Stage 4 retro 이월 | Stage 5 — ○ | ○ context-builder 에 `$nodes` 수집 로직 존재, flow handler 연결 미완 |
| 7 | worktree/DB isolation (shadow mode Phase P 완전 격리) | Stage 3 retro #2, Stage 4 retro #1 | Stage 5+ | △ 로드맵 명시 없음 |
| 8 | gate timeout (condition 재평가 polling + 타임아웃) | Stage 4 retro 이월 | Stage 5+ | △ 로드맵 명시 없음 |
| 9 | parallelism in loop (forEach parallelism > 1) | Stage 4 retro 이월 | Stage 5+ | △ 로드맵 명시 없음 |
| 10 | spawn 공통 유틸 추출 | Stage 3 retro #3 | 리팩토링 | △ 로드맵 명시 없음 |
| 11 | HookEngine agent/http type 통합 | Stage 3 retro #4 | Stage 4+ | △ Stage 4 에서도 미처리 |
| 12 | 설계 문서 sync Part 4 (9건) | Stage 3 retro 조정 9건 | 문서 작업 | △ 로드맵 명시 없음 |
| 13 | 실제 pipeline trigger 연결 (task_created → PipelineExecutor.run()) | Stage 4 retro 다음단계 | Stage 5 — ○ | ○ 로드맵 "Triggers" 에 해당 |

**범례**: ○ = 로드맵과 일치, △ = 불일치 또는 누락

---

## 3장. Checkpoint 복원 설계 vs 실구현 갭

### 3.1 설계 요약

설계 문서 `23_PhaseP_design4c2_durability_observability.md` — **파일 없음**.
프로젝트 내에 durability/checkpoint 관련 설계 문서가 존재하지 않음.

DB 스키마에서 추론 가능한 설계 의도:

- `pipeline_runs.lastCheckpointAt` (text) — checkpoint 시점 기록용 컬럼 존재 (`src/lib/db/schema.ts:197`)
- `pipeline_runs.resumedFromRunId` (text) — 이전 run 에서 resume 추적 (`src/lib/db/schema.ts:210`)
- `pipeline_runs.lastResumedAt` (text) — 마지막 resume 시점 (`src/lib/db/schema.ts:211`)
- `pipeline_runs.resumeCount` (integer) — resume 횟수 카운터 (`src/lib/db/schema.ts:212`)
- `pipeline_runs.status` enum 에 `'resumed'` 포함 (`src/lib/db/schema.ts:192`)

→ DB 스키마는 checkpoint + resume 를 이미 예상하고 설계됨.

### 3.2 현재 구현 상태

- **Checkpoint snapshot**: **NO** — 노드 단위 checkpoint 저장/복원 로직 없음
- **복원 코드 존재 여부**: **NO**
  - `restore` 키워드 검색 결과: `vi.restoreAllMocks()` (테스트 코드)만 발견
  - `checkpoint` 키워드 검색 결과: `lastCheckpointAt` DB 컬럼 정의만 발견
  - 실제 checkpoint 생성·복원 함수는 전혀 없음
- **StateStore**: In-memory 구현 (`src/lib/adpl/engine/state/store.ts`)
  - `private runs = new Map<string, PipelineRunState>()` (line 14)
  - 프로세스 재시작 시 모든 상태 소멸
  - DB 직렬화/역직렬화 없음
- **parallel/loop 중간 상태 수용**: 부분적
  - `FlowRunState` 에 `branchResults` (parallel), `currentIteration`/`completedIterations` (loop) 필드 존재 (`store.ts:166-184`)
  - 하지만 이 상태를 DB 에 저장하는 코드 없음
- **재시작 restore 로직**: **없음** — `StateStore.create()` 만 있고 `restore()`/`load()` 메서드 없음

### 3.3 갭 요약

| 항목 | 설계(DB 스키마) | 구현 | 갭 |
|------|---------------|------|-----|
| checkpoint 시점 기록 | `lastCheckpointAt` 컬럼 | 미사용 | DB 컬럼은 있으나 write 코드 없음 |
| resume 메타데이터 | `resumedFromRunId`, `resumeCount` | 미사용 | 동일 |
| StateStore 직렬화 | 암묵적 전제 | In-memory only | 직렬화/역직렬화 전체 구현 필요 |
| FlowRunState 복원 | branchResults/iterationResults 존재 | 메모리에만 유지 | DB-backed 전환 필요 |
| NodeRunState 복원 | node_runs 테이블 존재 | StateStore 와 미연결 | ORM 매핑 필요 |

---

## 4장. Expression Hybrid Slot2 상태

### 4.1 현재 구현 레벨

- **Slot1 (dot-access)**: **완성**
  - `condition-evaluator.ts:resolveField()` (line 111-155): `$nodes.stepId.data.field` 형태의 dot-access 지원
  - `StructuredCondition` 15개 연산자 (eq/neq/lt/lte/gt/gte/in/nin/contains/startsWith/endsWith/matches/exists/empty/truthy) 완전 구현 (`condition-evaluator.ts:49-104`)
  - `loop-handler.ts:resolveOverExpression()` (line 36-47): `$` 경로 간이 파서. 단, 현재 context 미연결로 `$nodes.X.Y.Z` 는 항상 `undefined` 반환
  - `context-builder.ts:collectCompletedNodeOutputs()` (line 59-71): `$nodes` 수집은 완성

- **Slot2 (Jexl fork)**: **0%**
  - `package.json` 에 jexl 패키지 없음
  - Jexl 관련 코드 0줄 (grep 결과: 주석 1건 `"Stage 5 이전 Jexl 미지원"` — `loop-handler.ts:34`)
  - string condition 입력 시 명시적 에러 throw (`loop-handler.ts:296-298`, `condition-evaluator.ts:7` 주석)

- **Slot3**: 유보 상태 유지 (로드맵 v1.5 후보에 "Slot 3 표현식: 고급 변환 filter/map/pluck" 기재)

### 4.2 Stage 5 목표 수준

Stage 4 retro 이월 항목 기준:
- `"$nodes.X.data.Y > 0.8"` 형태의 **비교 연산** 문자열 조건 지원 필수
- `"$nodes.score >= 80"` 이 branch/loop/gate condition 에서 동작해야 함
- 더 복잡한 구문(함수 호출 `max()`, 중첩 삼항 연산자 등)은 Slot3 범위 — Stage 5 목표 아님

### 4.3 Jexl 패키지 상태

- `package.json` 에 jexl **없음**
- `node_modules` 에 jexl **없음**
- 관련 설정 파일 **없음**
- 설계 문서 `20_PhaseP_design4b5_prep_expression_comparison.md`, `21_PhaseP_design4b5_expression.md` — **파일 없음**

---

## 5장. DB · worktree 격리

### 5.1 현재 공유 구조

**Legacy worktree 방식** (`src/worker/pipeline-worktree.ts`):
- `createCodingWorktree()` (line 30-71): task 별 git worktree 생성 (`projectDir/.autodev/worktrees/<suffix>`)
- `mergeWorktree()` (line 76-152): worktree 변경 사항을 원본 branch 로 merge
- `cleanupWorktree()` (line 157-176): worktree + branch 정리

**Phase P executor 의 worktree 사용** (`src/lib/adpl/engine/executor.ts`):
- `worktreeRoot` 는 `ExecutorInput` 의 필수 필드 (line 22)
- `path.isAbsolute(input.worktreeRoot)` 검증 (line 88)
- 단일 worktreeRoot 를 모든 노드가 공유

**DB 공유**: Phase P 의 StateStore 는 in-memory. Legacy 와 동일 SQLite DB (`src/lib/db/schema.ts`) 사용. Phase P 전용 테이블 (`pipeline_runs`, `node_runs` 등) 이 legacy 테이블과 같은 DB 파일에 존재.

**Stage 3 C9-3 shadow 우회**: shadow mode (`src/worker/shadow-runner.ts`) 에서 Phase P executor 가 실제 agent 를 호출하되, 결과만 `shadow_runs` 테이블에 기록. worktree/DB 분리 없음 — legacy primary + Phase P shadow 가 같은 DB/파일시스템 사용.

### 5.2 잠재 문제

1. **parallel flow node**: branches 가 동시에 같은 worktreeRoot 에서 파일 수정 시 race condition
2. **loop forEach parallelism > 1**: 동일 문제 — 여러 iteration 이 같은 디렉토리에서 동시 실행
3. **shadow mode 비용**: 실제 LLM 호출 2배 (격리 미구현)
4. **DB 동시 쓰기**: SQLite WAL 모드라 해도, Phase P 와 legacy 가 동시에 같은 테이블에 쓰면 lock contention

### 5.3 worktree 설정 지점

| 파일 | 줄번호 | 역할 |
|------|:------:|------|
| `src/worker/pipeline-worktree.ts:48` | 48 | worktreePath 계산 (`join(projectDir, '.autodev', 'worktrees', suffix)`) |
| `src/worker/pipeline-worktree.ts:58` | 58 | `git worktree add` 실행 |
| `src/worker/pipeline-parallel.ts:25-29` | 25 | parallel sub-task 용 worktree 생성 |
| `src/worker/pipeline-arena.ts:125-131` | 125 | arena agent 용 worktree 생성 |
| `src/lib/adpl/engine/executor.ts:22` | 22 | Phase P `ExecutorInput.worktreeRoot` 정의 |
| `src/lib/adpl/engine/executor.ts:88-90` | 88 | worktreeRoot 절대경로 검증 |
| `src/worker/pipeline-facade.ts:110` | 110 | facade 에서 worktreeRoot resolve |
| `src/worker/shadow-runner.ts:93` | 93 | shadow runner 에서 worktreeRoot resolve |
| `src/lib/db/schema.ts:142-163` | 142 | `worktrees` 테이블 정의 |
| `src/lib/db/schema.ts:166-181` | 166 | `worktree_sessions` 테이블 정의 |

### 5.4 격리 전략 옵션

| 전략 | 장점 | 단점 | 구현 난이도 |
|------|------|------|:----------:|
| 별도 DB (Phase P 전용 SQLite 파일) | 완전 격리, lock contention 제거 | 데이터 동기화 필요, 트랜잭션 일관성 불가 | 높음 |
| 별도 worktree (branch 당 git worktree) | 파일 수준 격리, legacy 패턴 재사용 | git worktree 생성/삭제 오버헤드, 디스크 사용량 증가 | 중간 |
| version prefix (DB 키에 runId prefix) | 현 DB 유지, 논리적 격리 | 쿼리 복잡도 증가, 물리적 격리 아님 | 낮음 |
| copy-on-write (실행 시작 시 DB snapshot) | 완전 격리 + 원본 보존 | snapshot 크기, 복원 비용, SQLite 특성 활용 어려움 | 높음 |

---

## 6장. break / continue

### 6.1 현재 Loop 제어 방식

현재 loop-handler (`src/lib/adpl/engine/scheduler/handlers/loop-handler.ts`) 의 제어 방식:

- **실패 시**: `throw new Error(...)` 로 즉시 전파 (line 210-213, 277-280, 346-349)
- **continueOnIterFailure**: 스키마에 `continueOnIterFailure?: boolean` 정의됨. 핸들러에서 `if (!spec.continueOnIterFailure)` 체크 후 throw/skip 분기 구현됨 (line 209). 단, 항상 false 가 기본이므로 실패 시 에러 전파.
- **breakCondition**: 스키마에 `breakCondition?: ConditionSchema` 필드 존재 (`src/lib/adpl/schemas/nodes/loop.ts:22`). 핸들러에서 **미사용** — breakCondition 평가 로직 없음.
- **CancellationToken**: `token.isCancelled` 체크로 외부 취소 지원 (line 179, 246)
- **maxIterations**: 초과 시 `LOOP_MAX_ITERATIONS_EXCEEDED` throw (line 168-171, 249-252, 324-327)

### 6.2 break/continue 구현 요구사항

- **LoopNodeSpec 에 break/continue 타입 정의 필요 여부**: 현재 `breakCondition` 필드는 존재하나, 독립적인 `break`/`continue` 노드 타입은 미정의. 두 가지 접근 가능:
  - (A) `breakCondition` 필드를 iteration 종료 시 평가하여 break 구현 (스키마 변경 최소)
  - (B) `break`/`continue` 를 독립 노드 타입으로 정의 (`type: 'break'`, `type: 'continue'`)

- **제어 신호 구현 방식**:
  - **예외 기반**: `throw new BreakSignal()` / `throw new ContinueSignal()` — 현재 에러 전파 패턴과 일관성, 단 catch 스코프 관리 필요
  - **특수 반환값**: `NodeOutput.status = 'break' | 'continue'` — 타입 확장 필요, Scheduler 에도 영향
  - **심볼**: `Symbol('break')` 반환 — TypeScript 타입 안전성 약화

- **Scheduler 내부 스택 관리 변경**: break 시 현재 loop 의 나머지 iteration + do[] 스킵 필요. 현재 loop-handler 가 자체적으로 for/do-while 루프를 관리하므로, handler 내부에서 break/continue 처리 가능 (Scheduler 변경 불필요할 수 있음).

### 6.3 현재 타입 정의 상태

- `breakCondition`: `ConditionSchema.optional()` — `src/lib/adpl/schemas/nodes/loop.ts:22`
- `BreakNodeSpec` / `ContinueNodeSpec`: **없음** — 독립 노드 타입 미정의
- `NodeStatus` enum 에 `'break'`/`'continue'`: **없음**
- `LoopNodeSpec.breakCondition` 타입: `Condition` (= `StructuredCondition | string`) — `src/lib/adpl/types/expression.ts:5`

---

## 7장. Stage 3 retro 잔여 항목

### 7.1 spawn 공통 유틸 추출

중복 지점:

| 파일 | 줄번호 | 패턴 |
|------|:------:|------|
| `src/lib/adpl/engine/adapters/shell/spawner.ts:38-48` | 38 | `spawn()` + `detached: true` + `killGroup()` (SIGKILL + process group) |
| `src/agents/verify/verify-agent.ts:915-935` | 915 | `spawn()` + `detached: true` + `process.kill(-child.pid!, 'SIGKILL')` |
| `src/lib/worker-manager.ts:32-58` | 32 | Worker fork (다른 패턴이지만 spawn 계열) |

`spawner.ts` 에 TODO 주석 존재: `// TODO: extract spawn utility in Stage 3 retro` (line 9)

**Stage 5 포함 여부**: NO — 기능에 영향 없는 리팩토링. Stage 5 범위 외 권장. 별도 리팩토링 태스크로 분리.

### 7.2 HookEngine agent/http 통합

현재 상태:
- `HookDefinition.type` 은 `'command' | 'script' | 'agent' | 'http'` 4종 정의 (`src/lib/hooks/hook-engine.ts:32`)
- 실제 실행은 `command` 와 `script` 만 구현 (grep 결과: `type: 'command'` 6건, `agent` 는 auto-passing fallback 1건)
- `agent` type hook: CLI 미발견 시 auto-pass (`hook-engine.ts:454`)
- `http` type hook: 실행 코드 미확인 (command 로 변환하는 코드 없음)
- Stage 3 C7-3 hook bridge 는 command/script → shell node 변환만 처리

**Stage 5 포함 여부**: NO — Stage 3 retro 에서 "Stage 4 또는 Phase P v1.1" 으로 기재. 현재까지 미처리. Stage 5 핵심 범위(Triggers + Expression) 와 직접 관련 없음. 별도 이슈로 관리 권장.

### 7.3 설계 문서 sync Part 4 (9건)

Stage 3 retro 에서 발췌한 9건 설계-구현 조정 사항:

1. ShellNodeSpec: `argv` → `args`, `shell` → `mode`
2. HttpNodeSpec: `retry.max` → `retryPolicy.maxAttempts`
3. adapter 경로: `src/lib/pipeline.ts` → `src/worker/pipeline.ts`
4. ROLE_MODEL_MATRIX: resolver.ts 단일 진실 소스
5. agent.input_degraded / agent.fallback 이벤트 분리
6. Verify Agent 전체 wrap → Stage 7 이월
7. Screenshots HOME 리디렉션 → Stage 7 이월
8. ToolPolicySpec: v1 inline 처리, 독립 레이어 v2+
9. Retry-After: adapter 레이어 담당

**Stage 5 포함 여부**: NO — 문서 작업이며 코드 변경 아님. `docs/phase-p/design-updates-needed.md` 에 기록됨. 별도 문서 태스크로 관리 또는 Stage 6 에서 일괄 정리.

---

## 8장. 예상 작업 블록 분해

### 8.1 로드맵 v7 원본 블록

```
| 5 | Triggers + Expression | 2-3주 |
```

세부 breakdown 없음. Stage 4 retro 의 "다음 단계" 섹션:

> Stage 5 주요 목표:
> 1. `$nodes` 실제 주입 — FlowNodeHandler 가 이전 노드 출력 참조 가능
> 2. Jexl expression 엔진 통합 — string condition 지원
> 3. DB-backed StateStore — checkpoint/resume
> 4. 실제 pipeline trigger 연결 (task_created → PipelineExecutor.run())
> 5. Pipeline UI (진행 상황 실시간 표시)

### 8.2 조사 기반 재조정안

| 블록 | 내용 | 예상 소요 | 우선순위 |
|------|------|:---------:|:--------:|
| **E1** | **$nodes 실제 주입 + resolveOverExpression 연결**: context-builder 의 `$nodes` 를 loop-handler 의 `resolveOverExpression` 에 연결. FlowNodeHandler 에 ExecutionContext 전달 경로 구축. `$loop` context 를 condition-evaluator 에 실제 주입. | 1일 | 높음 |
| **E2** | **Jexl Slot2 expression 엔진**: jexl 패키지 설치 + fork/wrapper 구현. string condition (`"$nodes.X.data.Y >= 80"`) 파서. branch/loop/gate 의 condition 필드에서 string → Jexl 평가 경로 연결. `resolveOverExpression` 에서 `$` 경로 Jexl 평가 지원. | 1-2일 | 높음 |
| **E3** | **Pipeline trigger 연결 + continueOnIterationFailure + breakCondition**: task_created 이벤트 → PipelineExecutor.run() 자동 실행. continueOnIterFailure 핸들러 동작 보완 (현재 부분 구현). breakCondition iteration 종료 시 평가 로직. | 1-2일 | 높음 |
| **E4** (선택) | **break/continue 노드 + forEach parallelism**: 독립 break/continue 신호 구현 (예외 기반 권장). forEach parallelism > 1 지원. human-approval gate 기본 설계. | 1-2일 | 중간 |
| **E5** (선택) | **통합 E2E + gate 확장 + retro**: 전체 통합 시나리오 (trigger → compile → schedule → execute with Jexl condition → checkpoint). Stage 5 retro 작성. | 1일 | 높음 |

### 8.3 전체 예상 소요

**필수 블록 (E1 + E2 + E3 + E5)**: 4-6일
**선택 블록 포함 (E1~E5 전체)**: 5-8일

근거:
- Stage 3·4 는 각각 1일 완성 — 하지만 이는 "기존 interface 위에 adapter 추가" 패턴
- Stage 5 는 성격이 다름: expression 엔진 신규 도입, context 연결 경로 전면 개편, trigger 연결은 legacy pipeline.ts 와의 통합 필요
- Jexl 패키지 선정·통합·테스트가 가장 큰 불확실성 요소
- DB-backed StateStore (checkpoint) 는 로드맵상 Stage 6 에 배치되어 있으므로 Stage 5 에서 제외 가능 → 제외하면 4-6일로 수렴

---

## 마지막 섹션. 구현 전 판단 필요 사항

### 판단 1: 보존 항목의 선후 순서

- **권고**: E1 ($nodes 주입) → E2 (Jexl) → E3 (Trigger + loop 보완) 순서
- **근거**:
  - E1 이 E2 의 전제조건: Jexl 에서 `$nodes.X.data.Y` 를 평가하려면 `$nodes` 가 실제 데이터로 채워져 있어야 함
  - E2 가 E3 의 전제조건: breakCondition 이 string condition 을 받을 수 있어야 Jexl 이 필요
  - Checkpoint (DB-backed StateStore) 는 로드맵 Stage 6 에 배치 → Stage 5 에서 제외

### 판단 2: Jexl Slot2 fork 범위

- **옵션 A**: 전체 포팅 — Jexl 의 모든 기능 (함수, 삼항, 배열 접근) 통합
- **옵션 B**: 메서드 선별적 구현 — 기본 비교 (`>`, `<`, `>=`, `<=`, `==`, `!=`, `&&`, `||`) + dot-access + 숫자/문자열 리터럴만
- **권고**: **옵션 B** (선별적)
- **근거**:
  - Stage 5 목표는 `"$nodes.score >= 80"` 수준의 조건 평가
  - 이미 StructuredCondition 이 15개 연산자로 복잡한 조건을 커버
  - Jexl 전체 포팅은 Slot3 범위 (v1.5 후보)
  - 선별적 구현이면 외부 패키지 의존 없이 자체 mini-evaluator 로도 가능 (패키지 도입 의사결정 별도)

### 판단 3: 격리 전략 선택

- **권고**: **version prefix** (DB 키에 runId prefix) + **기존 git worktree** 패턴 재사용
- **근거**:
  - 별도 DB 는 과잉 — Phase P 와 legacy 가 같은 프로세스에서 동작하므로 트랜잭션 분리가 불필요
  - 기존 `pipeline-worktree.ts`, `pipeline-parallel.ts` 에 이미 task 별 worktree 생성 패턴이 있음. Phase P parallel branch 에 동일 패턴 적용 가능
  - StateStore 의 in-memory Map 은 runId 로 이미 격리됨 → 추가 prefix 불필요
  - 파일시스템 격리만 worktree 로 해결하면 충분

### 판단 4: Stage 5 이후 확실히 안 하는 것

- **UI (Pipeline 진행 상황 실시간 표시)**: Stage 7 에서 처리 (로드맵 명시)
- **DB-backed StateStore + checkpoint resume**: Stage 6 Durability 에서 처리 (로드맵 명시)
- **문서 sync 9건**: 별도 문서 태스크 또는 Stage 6
- **spawn 공통 유틸 추출**: 별도 리팩토링 태스크
- **HookEngine agent/http 통합**: v1.1 또는 별도 이슈
- **human-approval gate (비동기 Slack 대기)**: 별도 설계 필요, Stage 5 에서는 condition gate 만 유지
- **Slot3 표현식 (filter/map/pluck)**: v1.5 후보

### 판단 5: 첫 구현 바스켓 추천

- **추천**: **E1 — $nodes 실제 주입 + resolveOverExpression 연결**
- **이유**: 가장 독립적이고 위험 낮음
  - 변경 범위가 명확: `context-builder.ts`, `loop-handler.ts`, `flow-handler.ts` 인터페이스 확장
  - 기존 코드의 `$nodes: collectCompletedNodeOutputs()` 가 이미 완성돼 있어 "연결"만 하면 됨
  - 외부 패키지 의존 없음
  - 테스트 패턴도 기존 `context-builder.test.ts` 확장으로 가능
  - E1 완료 후 E2 (Jexl) 진입 시 `$nodes` 데이터가 실제로 흐르므로 Jexl 통합 테스트가 가능해짐
